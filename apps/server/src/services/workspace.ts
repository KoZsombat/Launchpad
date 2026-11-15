import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "../config";
import { docker } from "../docker/client";
import { containerIdFromCgroup } from "../lib/container-id";
import { dataDirHostPath } from "../lib/mounts";
import type { AppRow } from "../db/schema";

let hostDataDirPromise: Promise<string | null> | null = null;

/** Candidate identifiers for the panel's own container. */
async function selfCandidates(): Promise<string[]> {
  const candidates = [os.hostname()];
  try {
    // Compose may set the hostname to the service name, so fall back to the cgroup id.
    const fromCgroup = containerIdFromCgroup(await readFile("/proc/self/cgroup", "utf8"));
    if (fromCgroup && !candidates.includes(fromCgroup)) candidates.push(fromCgroup);
  } catch {
    // Not a container, or cgroups are unavailable.
  }
  return candidates;
}

async function detectHostDataDir(): Promise<string | null> {
  for (const candidate of await selfCandidates()) {
    try {
      const info = await docker.getContainer(candidate).inspect();
      const source = dataDirHostPath(info.Mounts ?? [], config.dataDir);
      if (source) return source;
    } catch {
      // Try the next candidate.
    }
  }
  console.warn(
    `Launchpad: could not resolve the host path of ${config.dataDir}; app terminals start in the SSH user's home. Set HOST_DATA_DIR to fix this.`,
  );
  return null;
}

/**
 * Host path behind the panel's data volume. Used to place app terminals in the
 * per-app workspace (`<data>/repos/<app id>`) instead of the SSH user's home.
 */
export function hostDataDir(): Promise<string | null> {
  hostDataDirPromise ??= detectHostDataDir();
  return hostDataDirPromise;
}

/** Workspace directory on the host that runs the app, or null when unknown. */
export async function appWorkspacePath(app: Pick<AppRow, "id" | "deployTarget">): Promise<string | null> {
  if (app.deployTarget !== "local") return null;
  const root = config.hostDataDir ?? (await hostDataDir());
  return root ? path.posix.join(root, "repos", app.id) : null;
}
