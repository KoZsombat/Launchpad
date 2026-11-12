import { describe, expect, it } from "vitest";
import { createAppSchema, updateAppSchema } from "./schemas";

const imageApp = {
  name: "blog",
  subdomain: "blog",
  sourceType: "image" as const,
  imageRef: "nginx:1.27",
  internalPort: 80,
};

describe("createAppSchema", () => {
  it("accepts a minimal image app and applies defaults", () => {
    const parsed = createAppSchema.safeParse(imageApp);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.healthPath).toBe("/");
    expect(parsed.data.envVars).toEqual([]);
    expect(parsed.data.volumes).toEqual([]);
    expect(parsed.data.cicdEnabled).toBe(false);
  });

  it("accepts a GitHub app with CI/CD enabled", () => {
    const parsed = createAppSchema.safeParse({
      ...imageApp,
      sourceType: "github",
      imageRef: undefined,
      repoUrl: "https://github.com/acme/blog.git",
      branch: "main",
      dockerfilePath: "Dockerfile",
      buildContext: ".",
      cicdEnabled: true,
      envVars: [
        { key: "DATABASE_URL", value: "postgres://example", secret: true },
        { key: "PORT", value: "3000", secret: false },
      ],
      volumes: [{ containerPath: "/data", volumeName: "blog-data" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects reserved subdomains", () => {
    for (const subdomain of ["panel", "proxmox", "www"]) {
      const parsed = createAppSchema.safeParse({ ...imageApp, subdomain });
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects uppercase and invalid DNS labels", () => {
    for (const subdomain of ["Blog", "my_blog", "-blog", "blog-", "a".repeat(64)]) {
      const parsed = createAppSchema.safeParse({ ...imageApp, subdomain });
      expect(parsed.success).toBe(false);
    }
  });

  it("requires an image reference for image sources", () => {
    const parsed = createAppSchema.safeParse({ ...imageApp, imageRef: "" });
    expect(parsed.success).toBe(false);
  });

  it("requires repository fields for GitHub sources", () => {
    const parsed = createAppSchema.safeParse({
      ...imageApp,
      sourceType: "github",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const paths = parsed.error.issues.map((issue) => issue.path[0]);
    expect(paths).toContain("repoUrl");
    expect(paths).toContain("branch");
    expect(paths).toContain("dockerfilePath");
    expect(paths).toContain("buildContext");
  });

  it("rejects CI/CD for image sources", () => {
    const parsed = createAppSchema.safeParse({ ...imageApp, cicdEnabled: true });
    expect(parsed.success).toBe(false);
  });

  it("rejects duplicate environment keys", () => {
    const parsed = createAppSchema.safeParse({
      ...imageApp,
      envVars: [
        { key: "TOKEN", value: "a", secret: true },
        { key: "TOKEN", value: "b", secret: true },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects invalid environment keys and paths outside the container", () => {
    expect(
      createAppSchema.safeParse({
        ...imageApp,
        envVars: [{ key: "1BAD", value: "x", secret: false }],
      }).success,
    ).toBe(false);

    expect(
      createAppSchema.safeParse({
        ...imageApp,
        volumes: [{ containerPath: "data", volumeName: "data" }],
      }).success,
    ).toBe(false);
  });

  it("rejects path traversal in Dockerfile paths", () => {
    const parsed = createAppSchema.safeParse({
      ...imageApp,
      sourceType: "github",
      repoUrl: "https://github.com/acme/blog",
      branch: "main",
      dockerfilePath: "../Dockerfile",
      buildContext: ".",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("updateAppSchema", () => {
  it("accepts a partial environment update", () => {
    const parsed = updateAppSchema.safeParse({
      envVars: [{ key: "TOKEN", secret: true }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty update", () => {
    expect(updateAppSchema.safeParse({}).success).toBe(false);
  });
});
