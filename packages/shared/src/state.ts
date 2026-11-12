export const DEPLOYMENT_STATUSES = [
  "queued",
  "building",
  "starting",
  "healthy",
  "failed",
] as const;

export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export const TERMINAL_DEPLOYMENT_STATUSES: readonly DeploymentStatus[] = ["healthy", "failed"];

const ALLOWED_TRANSITIONS: Record<DeploymentStatus, readonly DeploymentStatus[]> = {
  queued: ["building", "failed"],
  building: ["starting", "failed"],
  starting: ["healthy", "failed"],
  healthy: [],
  failed: [],
};

export function canTransition(from: DeploymentStatus, to: DeploymentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: DeploymentStatus, to: DeploymentStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid deployment transition: ${from} -> ${to}`);
  }
}

export function isTerminalStatus(status: DeploymentStatus): boolean {
  return TERMINAL_DEPLOYMENT_STATUSES.includes(status);
}
