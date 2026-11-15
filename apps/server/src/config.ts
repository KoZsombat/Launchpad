import { config as loadEnv } from "dotenv";
import path from "node:path";
import { z } from "zod";

loadEnv({ quiet: true });
loadEnv({ path: path.resolve(process.cwd(), "../../.env"), quiet: true, override: false });

const booleanFromEnv = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "true" || value === "1"));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  BASE_DOMAIN: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
      "BASE_DOMAIN must be an apex domain, e.g. example.com",
    ),
  ADMIN_EMAIL: z.string().trim().email(),
  ADMIN_PASSWORD: z.string().min(8, "ADMIN_PASSWORD must be at least 8 characters"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
  ENCRYPTION_KEY: z.string().min(16, "ENCRYPTION_KEY must be at least 16 characters"),
  DATABASE_PATH: z.string().optional(),
  DATA_DIR: z.string().optional(),
  HOST_DATA_DIR: z.string().optional(),
  MIGRATIONS_DIR: z.string().optional(),
  WEB_DIST: z.string().optional(),
  DOCKER_NETWORK: z.string().trim().min(1).default("web"),
  HEALTH_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(900_000).default(90_000),
  HEALTH_INTERVAL_MS: z.coerce.number().int().min(500).max(30_000).default(2_000),
  COOKIE_SECURE: booleanFromEnv,
  GITHUB_API_URL: z.url().default("https://api.github.com"),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(1),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(env)"}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${details}`);
}

const env = parsed.data;
const dataDir = path.resolve(env.DATA_DIR ?? path.join(process.cwd(), "data"));

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  port: env.PORT,
  baseDomain: env.BASE_DOMAIN,
  panelUrl: env.BETTER_AUTH_URL.replace(/\/$/, ""),
  adminEmail: env.ADMIN_EMAIL,
  adminPassword: env.ADMIN_PASSWORD,
  betterAuthSecret: env.BETTER_AUTH_SECRET,
  betterAuthUrl: env.BETTER_AUTH_URL.replace(/\/$/, ""),
  encryptionKey: env.ENCRYPTION_KEY,
  dataDir,
  /** Host path of the data volume; auto-detected at runtime when unset. */
  hostDataDir: env.HOST_DATA_DIR ? env.HOST_DATA_DIR.replace(/\/+$/, "") : null,
  reposDir: path.join(dataDir, "repos"),
  databasePath: path.resolve(env.DATABASE_PATH ?? path.join(dataDir, "launchpad.db")),
  migrationsDir: path.resolve(env.MIGRATIONS_DIR ?? path.join(process.cwd(), "drizzle")),
  webDist: path.resolve(env.WEB_DIST ?? path.join(process.cwd(), "../web/dist")),
  dockerNetwork: env.DOCKER_NETWORK,
  healthTimeoutMs: env.HEALTH_TIMEOUT_MS,
  healthIntervalMs: env.HEALTH_INTERVAL_MS,
  cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === "production",
  githubApiUrl: env.GITHUB_API_URL.replace(/\/$/, ""),
  trustProxy: env.TRUST_PROXY,
} as const;
