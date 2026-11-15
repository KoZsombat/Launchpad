import { describe, expect, it } from "vitest";
import { dataDirHostPath } from "./mounts";

describe("dataDirHostPath", () => {
  it("returns the host source of the data mount", () => {
    const mounts = [
      { Destination: "/var/run/docker.sock", Source: "/var/run/docker.sock" },
      { Destination: "/data", Source: "/root/Launchpad/data" },
    ];
    expect(dataDirHostPath(mounts, "/data")).toBe("/root/Launchpad/data");
  });

  it("ignores other keys and returns null when the volume is not mounted", () => {
    const mounts = [{ Destination: "/tmp", Source: "/tmp" }];
    expect(dataDirHostPath(mounts, "/data")).toBeNull();
  });
});
