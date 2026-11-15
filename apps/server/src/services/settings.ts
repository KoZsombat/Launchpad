import { eq } from "drizzle-orm";
import type { SettingsView } from "@launchpad/shared";
import { config } from "../config";
import { decryptOptional, encryptOptional } from "../crypto";
import { db } from "../db";
import { settings, type SettingsRow } from "../db/schema";

const SETTINGS_ID = "global";

export function getSettingsRow(): SettingsRow {
  const existing = db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get();
  if (existing) return existing;
  db.insert(settings)
    .values({ id: SETTINGS_ID, updatedAt: new Date() })
    .onConflictDoNothing()
    .run();
  const created = db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get();
  if (!created) throw new Error("Failed to initialize settings row.");
  return created;
}

export function getBaseDomain(): string {
  return getSettingsRow().baseDomain ?? config.baseDomain;
}

export function getPanelUrl(): string {
  return config.panelUrl;
}

export function getUploadLimitMb(): number {
  return getSettingsRow().uploadLimitMb;
}

export function getSettingsView(): SettingsView {
  const row = getSettingsRow();
  return {
    baseDomain: row.baseDomain ?? config.baseDomain,
    panelUrl: getPanelUrl(),
    githubTokenSet: Boolean(row.githubTokenEnc),
    ghcrUsername: row.ghcrUsername,
    ghcrTokenSet: Boolean(row.ghcrTokenEnc),
    sshHost: row.sshHost,
    sshPort: row.sshPort,
    sshUsername: row.sshUsername,
    sshAuthMethod: row.sshAuthMethod,
    sshPasswordSet: Boolean(row.sshPasswordEnc),
    sshPrivateKeySet: Boolean(row.sshPrivateKeyEnc),
    uploadLimitMb: row.uploadLimitMb,
  };
}

export interface SettingsUpdate {
  baseDomain?: string;
  githubToken?: string | null;
  ghcrUsername?: string | null;
  ghcrToken?: string | null;
  sshHost?: string | null;
  sshPort?: number | null;
  sshUsername?: string | null;
  sshAuthMethod?: "password" | "key" | null;
  sshPassword?: string | null;
  sshPrivateKey?: string | null;
  uploadLimitMb?: number;
}

export function updateSettings(input: SettingsUpdate): SettingsView {
  const current = getSettingsRow();
  const next = {
    baseDomain: input.baseDomain ?? current.baseDomain,
    githubTokenEnc:
      input.githubToken === undefined
        ? current.githubTokenEnc
        : encryptOptional(input.githubToken),
    ghcrUsername:
      input.ghcrUsername === undefined
        ? current.ghcrUsername
        : input.ghcrUsername || null,
    ghcrTokenEnc:
      input.ghcrToken === undefined ? current.ghcrTokenEnc : encryptOptional(input.ghcrToken),
    sshHost:
      input.sshHost === undefined ? current.sshHost : input.sshHost || null,
    sshPort:
      input.sshPort === undefined ? current.sshPort : input.sshPort,
    sshUsername:
      input.sshUsername === undefined ? current.sshUsername : input.sshUsername || null,
    sshAuthMethod:
      input.sshAuthMethod === undefined ? current.sshAuthMethod : input.sshAuthMethod,
    sshPasswordEnc:
      input.sshPassword === undefined
        ? current.sshPasswordEnc
        : encryptOptional(input.sshPassword),
    sshPrivateKeyEnc:
      input.sshPrivateKey === undefined
        ? current.sshPrivateKeyEnc
        : encryptOptional(input.sshPrivateKey),
    uploadLimitMb: input.uploadLimitMb ?? current.uploadLimitMb,
    updatedAt: new Date(),
  };
  db.update(settings).set(next).where(eq(settings.id, SETTINGS_ID)).run();
  return getSettingsView();
}

export function getGithubToken(): string | null {
  return decryptOptional(getSettingsRow().githubTokenEnc);
}

export interface GhcrCredentials {
  username: string;
  password: string;
}

export function getGhcrCredentials(): GhcrCredentials | null {
  const row = getSettingsRow();
  const password = decryptOptional(row.ghcrTokenEnc);
  if (!row.ghcrUsername || !password) return null;
  return { username: row.ghcrUsername, password };
}


export interface SshCredentials {
  host: string;
  port: number;
  username: string;
  authMethod: "password" | "key";
  password: string | null;
  privateKey: string | null;
}

export function getSshCredentials(): SshCredentials | null {
  const row = getSettingsRow();
  if (!row.sshHost || !row.sshUsername) return null;
  const authMethod = row.sshAuthMethod ?? "password";
  const password = decryptOptional(row.sshPasswordEnc);
  const privateKey = decryptOptional(row.sshPrivateKeyEnc);
  if (authMethod === "password" && !password) return null;
  if (authMethod === "key" && !privateKey) return null;
  return {
    host: row.sshHost,
    port: row.sshPort ?? 22,
    username: row.sshUsername,
    authMethod,
    password,
    privateKey,
  };
}
