import { describe, expect, it } from "vitest";
import { buildTraefikLabels } from "./labels";

describe("buildTraefikLabels", () => {
  it("builds the host rule, service port and health check", () => {
    const labels = buildTraefikLabels({
      appId: "8d2f9e6a-0000-4000-8000-000000000001",
      subdomain: "blog",
      baseDomain: "example.com",
      port: 3000,
      healthPath: "/healthz",
    });

    expect(labels["traefik.enable"]).toBe("true");
    expect(labels["traefik.docker.network"]).toBe("web");
    expect(labels["traefik.http.routers.lp-8d2f9e6a-0000-4000-8000-000000000001.rule"]).toBe(
      "Host(`blog.example.com`)",
    );
    expect(
      labels["traefik.http.routers.lp-8d2f9e6a-0000-4000-8000-000000000001.entrypoints"],
    ).toBe("web");
    expect(
      labels["traefik.http.routers.lp-8d2f9e6a-0000-4000-8000-000000000001.service"],
    ).toBe("lp-8d2f9e6a-0000-4000-8000-000000000001");
    expect(
      labels["traefik.http.services.lp-8d2f9e6a-0000-4000-8000-000000000001.loadbalancer.server.port"],
    ).toBe("3000");
    expect(
      labels[
        "traefik.http.services.lp-8d2f9e6a-0000-4000-8000-000000000001.loadbalancer.healthcheck.path"
      ],
    ).toBe("/healthz");
  });

  it("defaults the health path to /", () => {
    const labels = buildTraefikLabels({
      appId: "app-id",
      subdomain: "api",
      baseDomain: "example.com",
      port: 8080,
    });
    expect(
      labels["traefik.http.services.lp-app-id.loadbalancer.healthcheck.path"],
    ).toBe("/");
  });

  it("returns identical router/service names for old and new containers of one app", () => {
    const first = buildTraefikLabels({
      appId: "same-app",
      subdomain: "blog",
      baseDomain: "example.com",
      port: 3000,
    });
    const second = buildTraefikLabels({
      appId: "same-app",
      subdomain: "blog",
      baseDomain: "example.com",
      port: 3000,
    });
    expect(first).toEqual(second);
  });
});
