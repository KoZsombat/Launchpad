import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { generateComposeFile, scanCompose, type ComposeRouteConfig } from "./compose";

const compose = `services:
  web:
    image: nginx:1.27
    ports:
      - "8080:80"
    environment:
      NODE_ENV: production
      APP_URL: \${APP_URL}
    depends_on:
      - db
    volumes:
      - uploads:/var/www/uploads
    networks:
      - default
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: \${DB_PASSWORD:-secret}
    ports:
      - "5432:5432"
    volumes:
      - dbdata:/var/lib/postgresql/data
volumes:
  uploads: {}
  dbdata: {}
`;

const routeConfigs: ComposeRouteConfig[] = [
  {
    name: "web",
    expose: true,
    subdomains: ["app", "www-app"],
    internalPort: 80,
    healthPath: "/healthz",
    env: { EXTRA: "1" },
  },
  {
    name: "db",
    expose: false,
    subdomains: [],
    internalPort: 5432,
    healthPath: "/",
    env: {},
  },
];

describe("scanCompose", () => {
  it("detects ports, environment, volumes and dependencies", () => {
    const scan = scanCompose(compose);
    expect(scan.services.map((service) => service.name)).toEqual(["web", "db"]);

    const web = scan.services[0];
    expect(web?.image).toBe("nginx:1.27");
    expect(web?.ports).toEqual([{ container: 80, protocol: "tcp" }]);
    expect(web?.suggestedPort).toBe(80);
    expect(web?.environment).toEqual(
      expect.arrayContaining([
        { key: "NODE_ENV", value: "production" },
        { key: "APP_URL", value: "${APP_URL}" },
      ]),
    );
    expect(web?.volumes).toEqual([
      { type: "volume", source: "uploads", target: "/var/www/uploads", readOnly: false },
    ]);
    expect(web?.dependsOn).toEqual(["db"]);

    expect(scan.requiredEnv).toEqual(["APP_URL"]);
    expect(scan.optionalEnv).toEqual(["DB_PASSWORD"]);
    expect(scan.volumes).toEqual(["uploads", "dbdata"]);
  });

  it("warns about services without a port", () => {
    const scan = scanCompose("services:\n  worker:\n    image: busybox\n");
    expect(scan.services[0]?.suggestedPort).toBeNull();
    expect(scan.services[0]?.warnings.join(" ")).toContain("No container port");
  });

  it("rejects invalid YAML and files without services", () => {
    expect(() => scanCompose("services: [")).toThrow(/Invalid YAML/);
    expect(() => scanCompose("version: '3'\n")).toThrow(/does not define any services/);
  });

  it("keeps data services unpublished and publishes HTTP services by default", () => {
    const scan = scanCompose(`services:
  db:
    image: postgres:17-alpine
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
  api:
    build: .
    ports: ["3001:3001"]
  worker:
    image: busybox
    command: sleep 300
`);
    const services = new Map(scan.services.map((service) => [service.name, service]));
    expect(services.get("db")?.suggestedExpose).toBe(false);
    expect(services.get("db")?.suggestedKind).toBe("data");
    expect(services.get("api")?.suggestedExpose).toBe(true);
    expect(services.get("api")?.suggestedKind).toBe("http");
    expect(services.get("worker")?.suggestedExpose).toBe(false);
    expect(services.get("worker")?.suggestedKind).toBe("other");
  });

  it("ignores comments and treats :+ references as optional", () => {
    const scan = scanCompose(`# requires \${COMMENTED}
services:
  web:
    image: nginx
    environment:
      MODE: \${MODE:+debug}
`);
    expect(scan.requiredEnv).toEqual([]);
    expect(scan.optionalEnv).toEqual(["MODE"]);
  });
});

describe("generateComposeFile", () => {
  const baseOptions = {
    compose,
    appId: "app-1",
    baseDomain: "example.com",
    deploymentId: "dep-1",
    projectName: "launchpad-app-1-dep-1",
    network: "web",
    volumePrefix: "launchpad-app-1-",
    services: routeConfigs,
    env: { APP_URL: "https://app.example.com" },
    remote: false,
  };

  it("routes multiple subdomains, strips published ports and merges environment", () => {
    const generated = generateComposeFile(baseOptions);
    const document = parseYaml(generated.yaml) as Record<string, any>;
    const web = document.services.web;

    expect(web.ports).toBeUndefined();
    expect(web.networks).toEqual({ default: {}, web: {} });
    expect(web.environment.EXTRA).toBe("1");
    expect(web.environment.APP_URL).toBe("https://app.example.com");
    expect(web.environment.NODE_ENV).toBe("production");
    expect(web.labels["traefik.enable"]).toBe("true");
    expect(web.labels["traefik.http.routers.lp-app-1-web.rule"]).toBe(
      "Host(`app.example.com`) || Host(`www-app.example.com`)",
    );
    expect(web.labels["traefik.http.services.lp-app-1-web.loadbalancer.server.port"]).toBe("80");
    expect(web.labels["launchpad.service"]).toBe("web");

    expect(document.services.db.ports).toBeUndefined();
    expect(document.services.db.labels["traefik.enable"]).toBeUndefined();
    expect(document.networks.web).toEqual({ external: true });
  });

  it("prefixes named volumes and exposes them as external volumes", () => {
    const generated = generateComposeFile(baseOptions);
    const document = parseYaml(generated.yaml) as Record<string, any>;
    expect(document.services.web.volumes).toEqual(["launchpad-app-1-uploads:/var/www/uploads"]);
    expect(document.volumes).toEqual({
      "launchpad-app-1-uploads": {
        external: true,
        name: "launchpad-app-1-uploads",
      },
      "launchpad-app-1-dbdata": {
        external: true,
        name: "launchpad-app-1-dbdata",
      },
    });
    expect(generated.volumes.sort()).toEqual([
      "launchpad-app-1-dbdata",
      "launchpad-app-1-uploads",
    ]);
  });

  it("refuses remote projects that need a build", () => {
    const buildCompose = `services:\n  web:\n    build: .\n    ports: ["3000:3000"]\n`;
    expect(() =>
      generateComposeFile({ ...baseOptions, compose: buildCompose, remote: true }),
    ).toThrow(/cannot build images on the remote host/);
  });

  it("refuses inline compose files that need a build", () => {
    const buildCompose = `services:\n  web:\n    build: .\n    ports: ["3000:3000"]\n`;
    expect(() =>
      generateComposeFile({ ...baseOptions, compose: buildCompose, allowBuild: false }),
    ).toThrow(/need a repository source/);
  });

  it("lets repository-sourced projects build", () => {
    const buildCompose = `services:\n  web:\n    build: .\n    ports: ["3000:3000"]\n`;
    const generated = generateComposeFile({
      ...baseOptions,
      compose: buildCompose,
      allowBuild: true,
      services: [routeConfigs[0]!],
    });
    expect(generated.serviceNames).toEqual(["web"]);
  });

  it("fails with the names of missing interpolation variables", () => {
    expect(() =>
      generateComposeFile({ ...baseOptions, env: {}, services: routeConfigs }),
    ).toThrow(/APP_URL/);
  });

  it("warns when a data service is published", () => {
    const dataCompose = `services:\n  db:\n    image: postgres:17-alpine\n`;
    const generated = generateComposeFile({
      ...baseOptions,
      compose: dataCompose,
      services: [
        {
          name: "db",
          expose: true,
          subdomains: ["db"],
          internalPort: 5432,
          healthPath: "/",
          env: {},
        },
      ],
    });
    expect(generated.warnings.join(" ")).toContain("looks like a data service");
  });

  it("refuses to route a service that uses network_mode", () => {
    const hostCompose = `services:\n  web:\n    image: nginx\n    network_mode: host\n    ports: ["80:80"]\n`;
    expect(() =>
      generateComposeFile({ ...baseOptions, compose: hostCompose, services: [routeConfigs[0]!] }),
    ).toThrow(/network_mode/);
  });
});
