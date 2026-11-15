import { describe, expect, it } from "vitest";
import { dataDirFromMountinfo, dataDirHostPath } from "./mounts";

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

describe("dataDirFromMountinfo", () => {
  const line =
    "653 644 8:64 /root/Launchpad/data /data rw,relatime master:31 - ext4 /dev/sde rw";

  it("returns the bind source path for the data mount", () => {
    expect(dataDirFromMountinfo(line, "/data")).toBe("/root/Launchpad/data");
  });

  it("ignores other mount points and missing entries", () => {
    expect(dataDirFromMountinfo(line, "/config")).toBeNull();
    expect(dataDirFromMountinfo("", "/data")).toBeNull();
  });
});
