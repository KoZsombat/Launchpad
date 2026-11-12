import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyGithubSignature } from "./webhook";

const secret = "super-secret";
const body = Buffer.from('{"ref":"refs/heads/main"}');
const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("verifyGithubSignature", () => {
  it("accepts a valid sha256 signature", () => {
    expect(verifyGithubSignature(body, signature, secret)).toBe(true);
  });

  it("rejects a modified body", () => {
    expect(
      verifyGithubSignature(Buffer.from('{"ref":"refs/heads/dev"}'), signature, secret),
    ).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifyGithubSignature(body, signature, "other-secret")).toBe(false);
  });

  it("rejects missing or malformed headers", () => {
    expect(verifyGithubSignature(body, undefined, secret)).toBe(false);
    expect(verifyGithubSignature(body, "", secret)).toBe(false);
    expect(verifyGithubSignature(body, "sha1=abc", secret)).toBe(false);
    expect(verifyGithubSignature(body, "sha256=not-hex", secret)).toBe(false);
    expect(verifyGithubSignature(body, `sha256=${"a".repeat(64)}`, secret)).toBe(false);
  });
});
