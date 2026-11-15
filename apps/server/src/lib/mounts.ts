/** Host path behind a container volume, from Docker's Mounts list. */
export function dataDirHostPath(
  mounts: { Destination?: string; Source?: string }[],
  containerDataDir: string,
): string | null {
  const mount = mounts.find((entry) => entry.Destination === containerDataDir);
  return mount?.Source ?? null;
}

/** Host source of a bind mount, recovered from `/proc/self/mountinfo` inside the container. */
export function dataDirFromMountinfo(mountinfo: string, containerDataDir: string): string | null {
  for (const line of mountinfo.split("\n")) {
    const fields = line.split(" ");
    if (fields[4] !== containerDataDir) continue;
    const root = fields[3];
    if (root && root.startsWith("/")) return root;
  }
  return null;
}
