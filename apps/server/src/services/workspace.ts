import os from "node:os";
import path from "node:path";
import { config } from "../config";
import { docker } from "../docker/client";
import type { AppRow } from "../db/schema";
import { dataDirHostPath } from "../lib/mounts";

let hostDataDirPromise: Promise<string | null> | null = null;

async function detectHostDataDir(): Promise<string | null> {
  try {
    // The panel runs in a container whose hostname defaults to its container id.
    const info = await docker.getContainer(os.hostname()).inspect();
    return dataDirHostPath(info.Mounts ?? [], config.dataDir);
  } catch {
    return null;
  }
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
