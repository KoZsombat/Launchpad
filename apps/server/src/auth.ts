import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { db } from "./db";
import { account, session, user, verification } from "./db/schema";
import { eq } from "drizzle-orm";

export const auth = betterAuth({
  appName: "Launchpad",
  secret: config.betterAuthSecret,
  baseURL: config.betterAuthUrl,
  basePath: "/api/auth",
  trustedOrigins: config.isProduction
    ? [config.betterAuthUrl]
    : [config.betterAuthUrl, "http://localhost:5173", "http://127.0.0.1:5173"],
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 8,
    maxPasswordLength: 256,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: { enabled: false },
  advanced: {
    useSecureCookies: config.cookieSecure,
    defaultCookieAttributes: {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: "lax",
      path: "/",
    },
    ipAddress: {
      ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
    },
  },
});

/**
 * Creates the single admin user from ADMIN_EMAIL / ADMIN_PASSWORD when the
 * user table is empty. Sign-up stays disabled for the public API; the rows are
 * inserted with Better Auth's own password hasher.
 */
export async function seedAdminUser(): Promise<void> {
  const existing = db.select({ id: user.id }).from(user).limit(1).all();
  if (existing.length > 0) return;

  const id = randomUUID();
  const now = new Date();
  const passwordHash = await hashPassword(config.adminPassword);

  db.transaction((tx) => {
    tx.insert(user)
      .values({
        id,
        name: config.adminEmail.split("@")[0] ?? "admin",
        email: config.adminEmail,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tx.insert(account)
      .values({
        id: randomUUID(),
        accountId: id,
        providerId: "credential",
        userId: id,
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });
}

export async function userExistsByEmail(email: string): Promise<boolean> {
  const rows = db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1).all();
  return rows.length > 0;
}
