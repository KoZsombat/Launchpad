/** Extracts the container id from `/proc/self/cgroup` (v1 and v2 layouts). */
export function containerIdFromCgroup(cgroup: string): string | null {
  const match = /(?:docker[-/])([0-9a-f]{64})/.exec(cgroup) ?? /([0-9a-f]{64})/.exec(cgroup);
  return match?.[1] ?? null;
}
