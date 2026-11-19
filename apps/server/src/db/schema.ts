import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** Single-file limit for the app terminal uploads; configurable in Settings. */
export const DEFAULT_UPLOAD_LIMIT_MB = 64;

/** Better Auth core tables (email + password, single user). */
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("session_token_unique").on(table.token),
    index("session_user_id_idx").on(table.userId),
  ],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export interface StoredEnvVar {
  key: string;
  secret: boolean;
  /** AES-256-GCM payload. Values are never stored in plaintext. */
  valueEnc: string;
}

export interface StoredComposeService {
  name: string;
  expose: boolean;
  subdomains: string[];
  internalPort: number;
  healthPath: string;
  envVars: StoredEnvVar[];
}

export const apps = sqliteTable("apps", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  subdomain: text("subdomain").notNull(),
  sourceType: text("source_type", { enum: ["image", "github", "compose"] }).notNull(),

  imageRef: text("image_ref"),
  registryUsername: text("registry_username"),
  registryPasswordEnc: text("registry_password_enc"),

  repoUrl: text("repo_url"),
  branch: text("branch"),
  dockerfilePath: text("dockerfile_path"),
  buildContext: text("build_context"),
  repoTokenEnc: text("repo_token_enc"),

  composeFile: text("compose_file"),
  composePath: text("compose_path"),
  composeServices: text("compose_services", { mode: "json" })
    .$type<StoredComposeService[]>()
    .notNull()
    .default([]),
  composeProject: text("compose_project"),
  deployTarget: text("deploy_target", { enum: ["local", "remote"] })
    .notNull()
    .default("local"),
  domain: text("domain"),

  access: text("access", { enum: ["http", "port", "none"] })
    .notNull()
    .default("http"),
  hostPort: integer("host_port"),
  portProtocol: text("port_protocol", { enum: ["tcp", "udp"] })
    .notNull()
    .default("tcp"),

  internalPort: integer("internal_port").notNull(),
  healthPath: text("health_path").notNull().default("/"),
  envVars: text("env_vars", { mode: "json" }).$type<StoredEnvVar[]>().notNull().default([]),
  volumes: text("volumes", { mode: "json" })
    .$type<{ containerPath: string; volumeName: string }[]>()
    .notNull()
    .default([]),

  cicdEnabled: integer("cicd_enabled", { mode: "boolean" }).notNull().default(false),
  webhookSecretEnc: text("webhook_secret_enc").notNull(),

  status: text("status", { enum: ["running", "stopped", "failed"] })
    .notNull()
    .default("stopped"),
  containerId: text("container_id"),
  imageTag: text("image_tag"),

  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const deployments = sqliteTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["queued", "building", "starting", "healthy", "failed"],
    }).notNull(),
    trigger: text("trigger", { enum: ["manual", "webhook", "github-push"] }).notNull(),
    imageTag: text("image_tag"),
    commitSha: text("commit_sha"),
    log: text("log").notNull().default(""),
    error: text("error"),
    queuedAt: integer("queued_at", { mode: "timestamp_ms" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("deployments_app_id_idx").on(table.appId),
    index("deployments_queued_at_idx").on(table.queuedAt),
  ],
);

export const settings = sqliteTable("settings", {
  id: text("id").primaryKey(),
  baseDomain: text("base_domain"),
  githubTokenEnc: text("github_token_enc"),
  ghcrUsername: text("ghcr_username"),
  ghcrTokenEnc: text("ghcr_token_enc"),

  sshHost: text("ssh_host"),
  sshPort: integer("ssh_port"),
  sshUsername: text("ssh_username"),
  sshAuthMethod: text("ssh_auth_method", { enum: ["password", "key"] }),
  sshPasswordEnc: text("ssh_password_enc"),
  sshPrivateKeyEnc: text("ssh_private_key_enc"),

  uploadLimitMb: integer("upload_limit_mb").notNull().default(DEFAULT_UPLOAD_LIMIT_MB),

  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export type AppRow = typeof apps.$inferSelect;
export type DeploymentRow = typeof deployments.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
