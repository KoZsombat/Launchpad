import { describe, expect, it } from "vitest";
import {
  RESERVED_SUBDOMAINS,
  appUrl,
  isReservedSubdomain,
  validateSlug,
  validateSubdomain,
} from "./subdomain";

describe("validateSubdomain", () => {
  it("accepts valid DNS labels", () => {
    for (const value of ["blog", "my-app", "a1", "a".repeat(63)]) {
      expect(validateSubdomain(value)).toEqual({ ok: true });
    }
  });

  it("rejects reserved names", () => {
    for (const value of RESERVED_SUBDOMAINS) {
      expect(validateSubdomain(value).ok).toBe(false);
      expect(isReservedSubdomain(value)).toBe(true);
    }
  });

  it("rejects empty, uppercase and malformed labels", () => {
    for (const value of ["", "Blog", "my_app", "-blog", "blog-", "a".repeat(64), "a..b"]) {
      expect(validateSubdomain(value).ok).toBe(false);
    }
  });

  it("returns a reason for invalid input", () => {
    const result = validateSubdomain("panel");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("reserved");
  });
});

describe("validateSlug", () => {
  it("accepts lowercase slugs", () => {
    expect(validateSlug("my-blog-2")).toEqual({ ok: true });
  });

  it("rejects invalid slugs", () => {
    for (const value of ["", "My-Blog", "my_blog", "-my", "my-", "a".repeat(64)]) {
      expect(validateSlug(value).ok).toBe(false);
    }
  });
});

describe("appUrl", () => {
  it("builds the public URL", () => {
    expect(appUrl("blog", "example.com")).toBe("https://blog.example.com");
  });

  it("uses http for localhost test hosts", () => {
    expect(appUrl("api", "localhost")).toBe("http://api.localhost");
  });
});
