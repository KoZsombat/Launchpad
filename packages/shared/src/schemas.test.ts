import { describe, expect, it } from "vitest";
import { createAppSchema, domainSchema, updateAppSchema } from "./schemas";

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

describe("domainSchema", () => {
  it("accepts real domains and localhost", () => {
    expect(domainSchema.safeParse("example.com").success).toBe(true);
    expect(domainSchema.safeParse("petrik.hu").success).toBe(true);
    expect(domainSchema.safeParse("staging.example.com").success).toBe(true);
    expect(domainSchema.safeParse("localhost").success).toBe(true);
  });

  it("rejects invalid hostnames", () => {
    for (const value of ["", "localhost:3000", "-bad.com", "bad_.com", "a".repeat(64) + ".com"]) {
      expect(domainSchema.safeParse(value).success).toBe(false);
    }
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

describe("compose projects", () => {
  const composeFile = `services:
  web:
    image: nginx:1.27
    ports: ["8080:80"]
  api:
    image: node:22
    ports: ["3000:3000"]
`;

  const composeApp = {
    name: "shop",
    subdomain: "shop",
    sourceType: "compose" as const,
    composeFile,
    internalPort: 80,
    composeServices: [
      {
        name: "web",
        expose: true,
        subdomains: ["shop", "www-shop"],
        internalPort: 80,
        healthPath: "/",
      },
      {
        name: "api",
        expose: true,
        subdomains: ["api-shop"],
        internalPort: 3000,
        healthPath: "/healthz",
      },
    ],
  };

  it("accepts a compose project with several routed services", () => {
    expect(createAppSchema.safeParse(composeApp).success).toBe(true);
  });

  it("accepts a per-project domain, including localhost", () => {
    expect(createAppSchema.safeParse({ ...composeApp, domain: "localhost" }).success).toBe(true);
    expect(createAppSchema.safeParse({ ...composeApp, domain: "petrik.hu" }).success).toBe(true);
    expect(createAppSchema.safeParse({ ...composeApp, domain: "bad_domain" }).success).toBe(false);
  });

  it("requires the primary subdomain to belong to a published service", () => {
    const parsed = createAppSchema.safeParse({ ...composeApp, subdomain: "other" });
    expect(parsed.success).toBe(false);
  });

  it("rejects a published service without a subdomain", () => {
    const parsed = createAppSchema.safeParse({
      ...composeApp,
      composeServices: [{ ...composeApp.composeServices[0]!, subdomains: [] }],
      subdomain: "shop",
    });
    expect(parsed.success).toBe(false);
  });

  it("keeps subdomains on unpublished services without claiming them", () => {
    const parsed = createAppSchema.safeParse({
      ...composeApp,
      subdomain: "api-shop",
      composeServices: [
        { ...composeApp.composeServices[0]!, expose: false, subdomains: ["shop", "www-shop"] },
        composeApp.composeServices[1]!,
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects duplicate subdomains across published services", () => {
    const parsed = createAppSchema.safeParse({
      ...composeApp,
      composeServices: [
        composeApp.composeServices[0]!,
        { ...composeApp.composeServices[1]!, subdomains: ["shop"] },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("requires a compose file or a repository", () => {
    const parsed = createAppSchema.safeParse({ ...composeApp, composeFile: undefined });
    expect(parsed.success).toBe(false);
  });
});
