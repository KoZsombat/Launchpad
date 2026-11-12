import { and, eq, ne, or } from "drizzle-orm";
import type {
  AppStatus,
  AvailabilityResult,
  CreateAppInput,
  PublicApp,
  PublicEnvVar,
  UpdateAppInput,
} from "@launchpad/shared";
import { appUrl, createAppSchema } from "@launchpad/shared";
import { randomUUID } from "node:crypto";
import { decryptOptional, encryptSecret, generateSecret } from "../crypto";
import { db } from "../db";
import { apps, type AppRow, type StoredEnvVar } from "../db/schema";
import { ApiError } from "../lib/errors";
import {
  getLatestDeployment,
  serializeDeployment,
} from "./deployments";

export function getAppRow(id: string): AppRow | undefined {
  return db.select().from(apps).where(eq(apps.id, id)).get();
}

export function requireAppRow(id: string): AppRow {
  const row = getAppRow(id);
  if (!row) throw new ApiError(404, "App not found.");
  return row;
}

export function listAppRows(): AppRow[] {
  return db.select().from(apps).all();
}

export function checkAvailability(name: string, subdomain: string): AvailabilityResult {
  const nameRows = db.select({ id: apps.id }).from(apps).where(eq(apps.name, name)).all();
  const subdomainRows = db
    .select({ id: apps.id })
    .from(apps)
    .where(eq(apps.subdomain, subdomain))
    .all();
  return {
    nameAvailable: nameRows.length === 0,
    subdomainAvailable: subdomainRows.length === 0,
  };
}

function assertUniqueIdentity(name: string, subdomain: string, excludeId?: string): void {
  const conflict = db
    .select({ id: apps.id, name: apps.name, subdomain: apps.subdomain })
    .from(apps)
    .where(
      excludeId
        ? and(or(eq(apps.name, name), eq(apps.subdomain, subdomain)), ne(apps.id, excludeId))
        : or(eq(apps.name, name), eq(apps.subdomain, subdomain)),
    )
    .get();
  if (!conflict) return;
  if (conflict.name === name) {
    throw new ApiError(409, `The name "${name}" is already in use.`, { field: "name" });
  }
  throw new ApiError(409, `The subdomain "${subdomain}" is already in use.`, {
    field: "subdomain",
  });
}

function toStoredEnv(entries: CreateAppInput["envVars"], existing: StoredEnvVar[] = []): StoredEnvVar[] {
  const byKey = new Map(existing.map((entry) => [entry.key, entry]));
  return entries.map((entry) => {
    if (entry.value === undefined) {
      const previous = byKey.get(entry.key);
      if (previous) {
        return { key: entry.key, secret: entry.secret, valueEnc: previous.valueEnc };
      }
      return { key: entry.key, secret: entry.secret, valueEnc: encryptSecret("") };
    }
    return { key: entry.key, secret: entry.secret, valueEnc: encryptSecret(entry.value) };
  });
}

export function createApp(input: CreateAppInput): AppRow {
  assertUniqueIdentity(input.name, input.subdomain);
  const id = randomUUID();
  const now = new Date();
  db.insert(apps)
    .values({
      id,
      name: input.name,
      subdomain: input.subdomain,
      sourceType: input.sourceType,
      imageRef: input.imageRef || null,
      registryUsername: input.registryUsername || null,
      registryPasswordEnc: input.registryPassword
        ? encryptSecret(input.registryPassword)
        : null,
      repoUrl: input.repoUrl || null,
      branch: input.branch || null,
      dockerfilePath: input.dockerfilePath || null,
      buildContext: input.buildContext || null,
      repoTokenEnc: input.repoToken ? encryptSecret(input.repoToken) : null,
      internalPort: input.internalPort,
      healthPath: input.healthPath,
      envVars: toStoredEnv(input.envVars),
      volumes: input.volumes,
      cicdEnabled: input.cicdEnabled,
      webhookSecretEnc: encryptSecret(generateSecret()),
      status: "stopped",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return requireAppRow(id);
}

function pickText(
  incoming: string | undefined,
  current: string | null,
): string | null {
  if (incoming === undefined) return current;
  return incoming === "" ? null : incoming;
}

function envPlain(entry: StoredEnvVar): string {
  try {
    return decryptOptional(entry.valueEnc) ?? "";
  } catch {
    return "";
  }
}

export function getEnvMap(row: AppRow): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of row.envVars) result[entry.key] = envPlain(entry);
  return result;
}

export function getRegistryPassword(row: AppRow): string | null {
  return decryptOptional(row.registryPasswordEnc);
}

export function getRepoToken(row: AppRow): string | null {
  return decryptOptional(row.repoTokenEnc);
}

export function getWebhookSecret(row: AppRow): string {
  return decryptOptional(row.webhookSecretEnc) ?? "";
}

function deploymentSignature(parts: {
  sourceType: string;
  imageRef: string | null;
  registryUsername: string | null;
  registryPassword: string | null;
  repoUrl: string | null;
  branch: string | null;
  dockerfilePath: string | null;
  buildContext: string | null;
  repoToken: string | null;
  internalPort: number;
  healthPath: string;
  envVars: { key: string; secret: boolean; value: string }[];
  volumes: { containerPath: string; volumeName: string }[];
}): string {
  return JSON.stringify({
    ...parts,
    envVars: [...parts.envVars].sort((a, b) => a.key.localeCompare(b.key)),
    volumes: [...parts.volumes].sort((a, b) => a.containerPath.localeCompare(b.containerPath)),
  });
}

function rowSignature(row: AppRow): string {
  return deploymentSignature({
    sourceType: row.sourceType,
    imageRef: row.imageRef,
    registryUsername: row.registryUsername,
    registryPassword: getRegistryPassword(row),
    repoUrl: row.repoUrl,
    branch: row.branch,
    dockerfilePath: row.dockerfilePath,
    buildContext: row.buildContext,
    repoToken: getRepoToken(row),
    internalPort: row.internalPort,
    healthPath: row.healthPath,
    envVars: row.envVars.map((entry) => ({
      key: entry.key,
      secret: entry.secret,
      value: envPlain(entry),
    })),
    volumes: row.volumes,
  });
}

export function updateApp(
  id: string,
  input: UpdateAppInput,
): { row: AppRow; needsRedeploy: boolean } {
  const existing = requireAppRow(id);
  const nextSubdomain = input.subdomain ?? existing.subdomain;
  assertUniqueIdentity(existing.name, nextSubdomain, id);

  const nextSourceType = input.sourceType ?? existing.sourceType;
  const nextImageRef = pickText(input.imageRef, existing.imageRef);
  const nextRegistryUsername = pickText(input.registryUsername, existing.registryUsername);
  const nextRepoUrl = pickText(input.repoUrl, existing.repoUrl);
  const nextBranch = pickText(input.branch, existing.branch);
  const nextDockerfilePath = pickText(input.dockerfilePath, existing.dockerfilePath);
  const nextBuildContext = pickText(input.buildContext, existing.buildContext);

  const nextRegistryPasswordPlain =
    input.registryPassword === undefined
      ? getRegistryPassword(existing)
      : input.registryPassword === ""
        ? null
        : input.registryPassword;
  const nextRepoTokenPlain =
    input.repoToken === undefined
      ? getRepoToken(existing)
      : input.repoToken === ""
        ? null
        : input.repoToken;

  const nextEnv = (
    input.envVars !== undefined
      ? toStoredEnv(input.envVars, existing.envVars)
      : existing.envVars
  ).map((entry) => ({ key: entry.key, secret: entry.secret }));
  const nextVolumes = input.volumes ?? existing.volumes;
  const nextHealthPath = input.healthPath ?? existing.healthPath;
  const nextPort = input.internalPort ?? existing.internalPort;
  const nextCicd = input.cicdEnabled ?? existing.cicdEnabled;

  createAppSchema.parse({
    name: existing.name,
    subdomain: nextSubdomain,
    sourceType: nextSourceType,
    imageRef: nextImageRef ?? undefined,
    registryUsername: nextRegistryUsername ?? undefined,
    registryPassword: nextRegistryPasswordPlain ?? undefined,
    repoUrl: nextRepoUrl ?? undefined,
    branch: nextBranch ?? undefined,
    dockerfilePath: nextDockerfilePath ?? undefined,
    buildContext: nextBuildContext ?? undefined,
    repoToken: nextRepoTokenPlain ?? undefined,
    internalPort: nextPort,
    healthPath: nextHealthPath,
    envVars: nextEnv,
    volumes: nextVolumes,
    cicdEnabled: nextCicd,
  });

  const nextSignature = deploymentSignature({
    sourceType: nextSourceType,
    imageRef: nextImageRef,
    registryUsername: nextRegistryUsername,
    registryPassword: nextRegistryPasswordPlain,
    repoUrl: nextRepoUrl,
    branch: nextBranch,
    dockerfilePath: nextDockerfilePath,
    buildContext: nextBuildContext,
    repoToken: nextRepoTokenPlain,
    internalPort: nextPort,
    healthPath: nextHealthPath,
    envVars:
      input.envVars !== undefined
        ? input.envVars.map((entry) => ({
            key: entry.key,
            secret: entry.secret,
            value: entry.value ?? envPlain(existing.envVars.find((e) => e.key === entry.key) ?? { key: "", secret: false, valueEnc: "" }),
          }))
        : existing.envVars.map((entry) => ({
            key: entry.key,
            secret: entry.secret,
            value: envPlain(entry),
          })),
    volumes: nextVolumes,
  });

  const needsRedeploy = nextSignature !== rowSignature(existing);
  const now = new Date();

  db.update(apps)
    .set({
      subdomain: nextSubdomain,
      sourceType: nextSourceType,
      imageRef: nextImageRef,
      registryUsername: nextRegistryUsername,
      registryPasswordEnc:
        input.registryPassword === undefined
          ? existing.registryPasswordEnc
          : input.registryPassword === ""
            ? null
            : encryptSecret(input.registryPassword),
      repoUrl: nextRepoUrl,
      branch: nextBranch,
      dockerfilePath: nextDockerfilePath,
      buildContext: nextBuildContext,
      repoTokenEnc:
        input.repoToken === undefined
          ? existing.repoTokenEnc
          : input.repoToken === ""
            ? null
            : encryptSecret(input.repoToken),
      internalPort: nextPort,
      healthPath: nextHealthPath,
      envVars:
        input.envVars !== undefined
          ? toStoredEnv(input.envVars, existing.envVars)
          : existing.envVars,
      volumes: nextVolumes,
      cicdEnabled: nextCicd,
      updatedAt: now,
    })
    .where(eq(apps.id, id))
    .run();

  return { row: requireAppRow(id), needsRedeploy };
}

export function setAppStatus(id: string, status: AppStatus): void {
  db.update(apps).set({ status, updatedAt: new Date() }).where(eq(apps.id, id)).run();
}

export function setAppDeployed(
  id: string,
  containerId: string,
  imageTag: string,
  status: AppStatus = "running",
): void {
  db.update(apps)
    .set({ containerId, imageTag, status, updatedAt: new Date() })
    .where(eq(apps.id, id))
    .run();
}

export function setAppContainerId(id: string, containerId: string | null): void {
  db.update(apps).set({ containerId, updatedAt: new Date() }).where(eq(apps.id, id)).run();
}

export function updateAppImageTag(id: string, imageTag: string): void {
  db.update(apps).set({ imageTag, updatedAt: new Date() }).where(eq(apps.id, id)).run();
}

export function deleteAppRow(id: string): void {
  db.delete(apps).where(eq(apps.id, id)).run();
}

function publicEnvVars(entries: StoredEnvVar[]): PublicEnvVar[] {
  return entries.map((entry) => {
    const plain = envPlain(entry);
    return {
      key: entry.key,
      secret: entry.secret,
      value: entry.secret ? null : plain,
      hasValue: plain.length > 0,
    };
  });
}

export function toPublicApp(row: AppRow, baseDomain: string): PublicApp {
  const lastDeployment = getLatestDeployment(row.id);
  return {
    id: row.id,
    name: row.name,
    subdomain: row.subdomain,
    url: appUrl(row.subdomain, baseDomain),
    sourceType: row.sourceType,
    imageRef: row.imageRef,
    registryUsername: row.registryUsername,
    registryPasswordSet: Boolean(row.registryPasswordEnc),
    repoUrl: row.repoUrl,
    branch: row.branch,
    dockerfilePath: row.dockerfilePath,
    buildContext: row.buildContext,
    repoTokenSet: Boolean(row.repoTokenEnc),
    internalPort: row.internalPort,
    healthPath: row.healthPath,
    envVars: publicEnvVars(row.envVars),
    volumes: row.volumes,
    cicdEnabled: row.cicdEnabled,
    status: row.status,
    containerId: row.containerId,
    imageTag: row.imageTag,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastDeployment: lastDeployment ? serializeDeployment(lastDeployment) : null,
  };
}
