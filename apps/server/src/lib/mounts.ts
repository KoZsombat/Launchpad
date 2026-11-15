/** Host path behind a container volume, from Docker's Mounts list. */
export function dataDirHostPath(
  mounts: { Destination?: string; Source?: string }[],
  containerDataDir: string,
): string | null {
  const mount = mounts.find((entry) => entry.Destination === containerDataDir);
  return mount?.Source ?? null;
}
