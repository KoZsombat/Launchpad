import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies GitHub's `X-Hub-Signature-256` header over the exact raw body.
 * The comparison is constant-time.
 */
export function verifyGithubSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const provided = signatureHeader.slice(prefix.length);
  if (!/^[a-f0-9]{64}$/i.test(provided)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
}

export function parseJsonBuffer(body: unknown): unknown {
  if (Buffer.isBuffer(body)) {
    try {
      return JSON.parse(body.toString("utf8"));
    } catch {
      return null;
    }
  }
  return body ?? null;
}
