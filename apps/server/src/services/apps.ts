import { and, eq, ne } from "drizzle-orm";
import type {
  AppStatus,
  AvailabilityResult,
  CreateAppInput,
  PublicApp,
  PublicComposeService,
  PublicEnvVar,
  UpdateAppInput,
} from "@launchpad/shared";
import { appUrl, createAppSchema } from "@launchpad/shared";
import { randomUUID } from "node:crypto";
import { decryptOptional, encryptSecret, generateSecret } from "../crypto";
import { db } from "../db";
import {
  apps,
  type AppRow,
  type StoredComposeService,
  type StoredEnvVar,
} from "../db/schema";
import { ApiError } from "../lib/errors";
import { getLatestDeployment, serializeDeployment } from "./deployments";
import { scanCompose } from "../deploy/compose";
import { getBaseDomain } from "./settings";

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

/** Every hostname an app answers on, including compose service routes. */
export function appSubdomains(row: AppRow): string[] {
  const values = [
    row.subdomain,
    ...row.composeServices
      .filter((service) => service.expose)
      .flatMap((service) => service.subdomains),
  ];
  return [...new Set(values.filter(Boolean))];
}

export function checkAvailability(
  name: string,
  subdomain: string,
  domain?: string | null,
): AvailabilityResult {
  const effectiveDomain = domain?.trim().toLowerCase() || getBaseDomain();
  const rows = db
    .select({
      id: apps.id,
      name: apps.name,
      subdomain: apps.subdomain,
      domain: apps.domain,
      composeServices: apps.composeServices,
    })
    .from(apps)
    .all();
  return {
    nameAvailable: !rows.some((row) => row.name === name),
    subdomainAvailable: !rows.some((row) => {
      if ((row.domain ?? getBaseDomain()) !== effectiveDomain) return false;
      return (
        row.subdomain === subdomain ||
        row.composeServices.some(
          (service) => service.expose && service.subdomains.includes(subdomain),
        )
      );
    }),
  };
}

function assertUniqueName(name: string, excludeId?: string): void {
  const conflict = db
    .select({ id: apps.id })
    .from(apps)
    .where(excludeId ? and(eq(apps.name, name), ne(apps.id, excludeId)) : eq(apps.name, name))
    .get();
  if (conflict) {
    throw new ApiError(409, `The name "${name}" is already in use.`, { field: "name" });
  }
}

function assertUniqueSubdomains(
  subdomains: string[],
  domain: string,
  excludeId?: string,
): void {
  const values = [...new Set(subdomains.filter(Boolean))];
  if (values.length === 0) return;
  const rows = db
    .select({
      id: apps.id,
      name: apps.name,
      subdomain: apps.subdomain,
      domain: apps.domain,
      composeServices: apps.composeServices,
    })
    .from(apps)
    .all();
  for (const row of rows) {
    if (excludeId && row.id === excludeId) continue;
    if ((row.domain ?? getBaseDomain()) !== domain) continue;
    const occupied = new Set([
      row.subdomain,
      ...row.composeServices
        .filter((service) => service.expose)
        .flatMap((service) => service.subdomains),
    ]);
    const conflict = values.find((value) => occupied.has(value));
    if (conflict) {
      throw new ApiError(409, `The subdomain "${conflict}" is already in use on ${domain}.`, {
        field: "subdomain",
      });
    }
  }
}

function assertHostPortAvailable(
  port: number,
  protocol: "tcp" | "udp",
  excludeId?: string,
): void {
  const rows = db
    .select({
      id: apps.id,
      access: apps.access,
      hostPort: apps.hostPort,
      portProtocol: apps.portProtocol,
      internalPort: apps.internalPort,
    })
    .from(apps)
    .all();
  for (const row of rows) {
    if (row.id === excludeId || row.access !== "port" || row.portProtocol !== protocol) continue;
    const effective = row.hostPort ?? row.internalPort;
    if (effective !== port) continue;
    throw new ApiError(
      409,
      `Host port ${port}/${protocol} is already published by another app.`,
      { field: "hostPort" },
    );
  }
}

function toStoredEnv(
  entries: CreateAppInput["envVars"],
  existing: StoredEnvVar[] = [],
): StoredEnvVar[] {
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

type ComposeServiceInput = CreateAppInput["composeServices"][number];

function toStoredComposeServices(
  entries: ComposeServiceInput[],
  existing: StoredComposeService[] = [],
): StoredComposeService[] {
  const byName = new Map(existing.map((service) => [service.name, service]));
  return entries.map((service) => ({
    name: service.name,
    expose: service.expose,
    subdomains: service.subdomains,
    internalPort: service.internalPort,
    healthPath: service.healthPath,
    envVars: toStoredEnv(service.envVars, byName.get(service.name)?.envVars ?? []),
  }));
}

/** Re-parses the stored compose snapshot and rejects configs that drifted from it. */
export function validateComposeConfig(
  composeFile: string | null,
  services: StoredComposeService[],
  extraEnvKeys: Iterable<string> = [],
): void {
  if (!composeFile) return;
  let scan;
  try {
    scan = scanCompose(composeFile);
  } catch (error) {
    throw new ApiError(422, error instanceof Error ? error.message : String(error), {
      field: "composeFile",
    });
  }
  const serviceNames = new Set(scan.services.map((service) => service.name));
  for (const service of services) {
    if (!serviceNames.has(service.name)) {
      throw new ApiError(
        422,
        `Compose service "${service.name}" was not found in the compose file. Rescan it.`,
        { field: "composeServices" },
      );
    }
  }
  const knownEnv = new Set(extraEnvKeys);
  const missing = scan.requiredEnv.filter((key) => !knownEnv.has(key));
  if (missing.length > 0) {
    throw new ApiError(
      422,
      `Missing compose values: ${missing.sort().join(", ")}. Add them to the project environment.`,
      { field: "envVars" },
    );
  }
}

export function createApp(input: CreateAppInput): AppRow {
  assertUniqueName(input.name);
  const exposed = input.composeServices.filter((service) => service.expose);
  const access: "http" | "port" | "none" =
    input.sourceType === "compose"
      ? exposed.length > 0
        ? "http"
        : "none"
      : input.access;
  const primarySubdomain =
    access !== "http"
      ? ""
      : input.sourceType === "compose"
        ? exposed[0]?.subdomains[0] ?? input.subdomain
        : input.subdomain;
  const allSubdomains =
    access === "http"
      ? [primarySubdomain, ...exposed.flatMap((service) => service.subdomains)]
      : [];
  const domain = input.domain?.trim().toLowerCase() || null;
  assertUniqueSubdomains(allSubdomains, domain ?? getBaseDomain());

  const storedServices = toStoredComposeServices(input.composeServices);
  if (input.sourceType === "compose") {
    validateComposeConfig(
      input.composeFile ?? null,
      storedServices,
      input.envVars.map((entry) => entry.key),
    );
  }

  const id = randomUUID();
  const now = new Date();
  const internalPort =
    input.sourceType === "compose"
      ? exposed[0]?.internalPort ?? 80
      : (input.internalPort ?? 80);
  const hostPort = access === "port" ? input.hostPort ?? internalPort : null;
  if (hostPort !== null) assertHostPortAvailable(hostPort, input.portProtocol);
  db.insert(apps)
    .values({
      id,
      name: input.name,
      subdomain: primarySubdomain,
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
      composeFile: input.composeFile || null,
      composePath: input.composePath || null,
      composeServices: storedServices,
      deployTarget: input.deployTarget,
      domain,
      access,
      hostPort,
      portProtocol: input.portProtocol,
      internalPort,
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

export function getServiceEnvMap(service: StoredComposeService): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of service.envVars) result[entry.key] = envPlain(entry);
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
  composeFile: string | null;
  composePath: string | null;
  deployTarget: string;
  domain: string | null;
  access: string;
  hostPort: number | null;
  portProtocol: string;
  composeServices: {
    name: string;
    expose: boolean;
    subdomains: string[];
    internalPort: number;
    healthPath: string;
    envVars: { key: string; secret: boolean; value: string }[];
  }[];
  internalPort: number;
  healthPath: string;
  envVars: { key: string; secret: boolean; value: string }[];
  volumes: { containerPath: string; volumeName: string }[];
}): string {
  return JSON.stringify({
    ...parts,
    envVars: [...parts.envVars].sort((a, b) => a.key.localeCompare(b.key)),
    volumes: [...parts.volumes].sort((a, b) => a.containerPath.localeCompare(b.containerPath)),
    composeServices: parts.composeServices.map((service) => ({
      ...service,
      subdomains: [...service.subdomains].sort(),
      envVars: [...service.envVars].sort((a, b) => a.key.localeCompare(b.key)),
    })),
  });
}

function storedComposeSignature(services: StoredComposeService[]) {
  return services.map((service) => ({
    name: service.name,
    expose: service.expose,
    subdomains: [...service.subdomains].sort(),
    internalPort: service.internalPort,
    healthPath: service.healthPath,
    envVars: service.envVars.map((entry) => ({
      key: entry.key,
      secret: entry.secret,
      value: envPlain(entry),
    })),
  }));
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
    composeFile: row.composeFile,
    composePath: row.composePath,
    deployTarget: row.deployTarget,
    domain: row.domain,
    access: row.access,
    hostPort: row.hostPort,
    portProtocol: row.portProtocol,
    composeServices: storedComposeSignature(row.composeServices),
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
  const nextSourceType = input.sourceType ?? existing.sourceType;
  const nextComposeFile = pickText(input.composeFile, existing.composeFile);
  const nextComposePath = pickText(input.composePath, existing.composePath);
  const nextComposeServices =
    input.composeServices !== undefined
      ? toStoredComposeServices(input.composeServices, existing.composeServices)
      : existing.composeServices;
  const nextDeployTarget = input.deployTarget ?? existing.deployTarget;
  const nextDomain =
    input.domain === undefined
      ? existing.domain
      : input.domain?.trim().toLowerCase() || null;
  const exposedServices = nextComposeServices.filter((service) => service.expose);
  const nextAccess: "http" | "port" | "none" =
    nextSourceType === "compose"
      ? exposedServices.length > 0
        ? "http"
        : "none"
      : input.access ?? existing.access;
  const nextSubdomain =
    nextAccess !== "http"
      ? ""
      : nextSourceType === "compose"
        ? input.subdomain ??
          exposedServices[0]?.subdomains[0] ??
          existing.subdomain
        : input.subdomain ?? existing.subdomain;

  assertUniqueName(existing.name, id);
  assertUniqueSubdomains(
    nextAccess === "http"
      ? [nextSubdomain, ...exposedServices.flatMap((service) => service.subdomains)]
      : [],
    nextDomain ?? getBaseDomain(),
    id,
  );

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

  const nextStoredEnv =
    input.envVars !== undefined
      ? toStoredEnv(input.envVars, existing.envVars)
      : existing.envVars;
  const nextVolumes = input.volumes ?? existing.volumes;
  const nextHealthPath = input.healthPath ?? existing.healthPath;
  const nextCicd = input.cicdEnabled ?? existing.cicdEnabled;
  const nextPort =
    input.internalPort ??
    (nextSourceType === "compose"
      ? nextComposeServices.find((service) => service.expose)?.internalPort ?? existing.internalPort
      : existing.internalPort);
  const nextPortProtocol = input.portProtocol ?? existing.portProtocol;
  const nextHostPort =
    nextAccess === "port"
      ? input.hostPort ??
        (existing.access === "port" ? existing.hostPort ?? existing.internalPort : nextPort)
      : null;
  if (nextHostPort !== null) {
    assertHostPortAvailable(nextHostPort, nextPortProtocol, id);
  }

  const validationEnv = (
    input.envVars !== undefined
      ? input.envVars.map((entry) => ({ key: entry.key, secret: entry.secret }))
      : existing.envVars.map((entry) => ({ key: entry.key, secret: entry.secret }))
  );
  const validationServices = nextComposeServices.map((service) => ({
    name: service.name,
    expose: service.expose,
    subdomains: service.subdomains,
    internalPort: service.internalPort,
    healthPath: service.healthPath,
    envVars: service.envVars.map((entry) => ({ key: entry.key, secret: entry.secret })),
  }));

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
    access: nextAccess,
    hostPort: nextHostPort ?? undefined,
    portProtocol: nextPortProtocol,
    healthPath: nextHealthPath,
    envVars: validationEnv,
    volumes: nextVolumes,
    cicdEnabled: nextCicd,
    deployTarget: nextDeployTarget,
    domain: nextDomain,
    composeFile: nextComposeFile ?? undefined,
    composePath: nextComposePath ?? undefined,
    composeServices: validationServices,
  });

  if (nextSourceType === "compose") {
    validateComposeConfig(nextComposeFile, nextComposeServices, validationEnv.map((entry) => entry.key));
  }

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
    composeFile: nextComposeFile,
    composePath: nextComposePath,
    deployTarget: nextDeployTarget,
    domain: nextDomain,
    access: nextAccess,
    hostPort: nextHostPort,
    portProtocol: nextPortProtocol,
    composeServices: storedComposeSignature(nextComposeServices),
    internalPort: nextPort,
    healthPath: nextHealthPath,
    envVars: nextStoredEnv.map((entry) => ({
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
      composeFile: nextComposeFile,
      composePath: nextComposePath,
      composeServices: nextComposeServices,
      deployTarget: nextDeployTarget,
      domain: nextDomain,
      access: nextAccess,
      hostPort: nextHostPort,
      portProtocol: nextPortProtocol,
      internalPort: nextPort,
      healthPath: nextHealthPath,
      envVars: nextStoredEnv,
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
  containerId: string | null,
  imageTag: string,
  status: AppStatus = "running",
  composeProject?: string | null,
): void {
  db.update(apps)
    .set({
      containerId,
      imageTag,
      status,
      ...(composeProject !== undefined ? { composeProject } : {}),
      updatedAt: new Date(),
    })
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

function publicComposeServices(services: StoredComposeService[]): PublicComposeService[] {
  return services.map((service) => ({
    name: service.name,
    expose: service.expose,
    subdomains: service.subdomains,
    internalPort: service.internalPort,
    healthPath: service.healthPath,
    envVars: publicEnvVars(service.envVars),
  }));
}

export function toPublicApp(row: AppRow, baseDomain: string): PublicApp {
  const lastDeployment = getLatestDeployment(row.id);
  const effectiveDomain = row.domain ?? baseDomain;
  return {
    id: row.id,
    name: row.name,
    subdomain: row.subdomain,
    subdomains: appSubdomains(row),
    url: row.subdomain ? appUrl(row.subdomain, effectiveDomain) : "",
    baseDomain: effectiveDomain,
    domain: row.domain,
    defaultDomain: baseDomain,
    sourceType: row.sourceType,
    access: row.access,
    hostPort: row.hostPort,
    portProtocol: row.portProtocol,
    deployTarget: row.deployTarget,
    imageRef: row.imageRef,
    registryUsername: row.registryUsername,
    registryPasswordSet: Boolean(row.registryPasswordEnc),
    repoUrl: row.repoUrl,
    branch: row.branch,
    dockerfilePath: row.dockerfilePath,
    buildContext: row.buildContext,
    composeFile: row.composeFile,
    composePath: row.composePath,
    composeServices: publicComposeServices(row.composeServices),
    composeProject: row.composeProject,
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

