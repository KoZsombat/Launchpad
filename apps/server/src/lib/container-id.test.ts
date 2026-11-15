import { describe, expect, it } from "vitest";
import { containerIdFromCgroup } from "./container-id";

const ID = "8f3c1d2e4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4";

describe("containerIdFromCgroup", () => {
  it("reads the cgroup v2 systemd scope", () => {
    expect(containerIdFromCgroup(`0::/system.slice/docker-${ID}.scope\n`)).toBe(ID);
  });

  it("reads the cgroup v1 docker path", () => {
    expect(containerIdFromCgroup(`12:devices:/docker/${ID}\n11:cpu:/docker/${ID}\n`)).toBe(ID);
  });

  it("returns null outside a container", () => {
    expect(containerIdFromCgroup("0::/user.slice/user-1000.slice/session-3.scope\n")).toBeNull();
  });
});
