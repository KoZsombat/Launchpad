import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { config } from "./config";

const KEY = createHash("sha256").update(config.encryptionKey).digest();
const PREFIX = "v1";

/** AES-256-GCM. Format: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("Unsupported encrypted value format.");
  }
  const iv = Buffer.from(parts[1] ?? "", "base64url");
  const tag = Buffer.from(parts[2] ?? "", "base64url");
  const ciphertext = Buffer.from(parts[3] ?? "", "base64url");
  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function encryptOptional(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return encryptSecret(value);
}

export function decryptOptional(value: string | null | undefined): string | null {
  if (!value) return null;
  return decryptSecret(value);
}

/** Constant-time comparison of two secrets, independent of length. */
export function secretEquals(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function generateSecret(): string {
  return randomBytes(32).toString("hex");
}
