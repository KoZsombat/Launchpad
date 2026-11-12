import { and, desc, eq, inArray } from "drizzle-orm";
import type {
  DeploymentDetail,
  DeploymentStatus,
  DeploymentSummary,
  DeploymentTrigger,
} from "@launchpad/shared";
import { assertTransition, isTerminalStatus } from "@launchpad/shared";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { deployments, type DeploymentRow } from "../db/schema";

export function serializeDeployment(row: DeploymentRow): DeploymentSummary {
  return {
    id: row.id,
    appId: row.appId,
    status: row.status,
    trigger: row.trigger,
    imageTag: row.imageTag,
    commitSha: row.commitSha,
    error: row.error,
    queuedAt: row.queuedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export function serializeDeploymentDetail(row: DeploymentRow): DeploymentDetail {
  return { ...serializeDeployment(row), log: row.log };
}

export function createDeploymentRow(
  appId: string,
  trigger: DeploymentTrigger,
  options: { imageTag?: string | null; commitSha?: string | null } = {},
): DeploymentRow {
  const id = randomUUID();
  const queuedAt = new Date();
  db.insert(deployments)
    .values({
      id,
      appId,
      status: "queued",
      trigger,
      imageTag: options.imageTag ?? null,
      commitSha: options.commitSha ?? null,
      log: "",
      queuedAt,
    })
    .run();
  const row = getDeploymentRow(id);
  if (!row) throw new Error("Failed to create deployment.");
  return row;
}

export function getDeploymentRow(id: string): DeploymentRow | undefined {
  return db.select().from(deployments).where(eq(deployments.id, id)).get();
}

export function getDeploymentForApp(appId: string, deploymentId: string): DeploymentRow | undefined {
  return db
    .select()
    .from(deployments)
    .where(and(eq(deployments.id, deploymentId), eq(deployments.appId, appId)))
    .get();
}

export function listDeployments(appId: string, limit = 50): DeploymentRow[] {
  return db
    .select()
    .from(deployments)
    .where(eq(deployments.appId, appId))
    .orderBy(desc(deployments.queuedAt))
    .limit(limit)
    .all();
}

export function getLatestDeployment(appId: string): DeploymentRow | undefined {
  return db
    .select()
    .from(deployments)
    .where(eq(deployments.appId, appId))
    .orderBy(desc(deployments.queuedAt))
    .limit(1)
    .get();
}

export function updateDeploymentStatus(
  id: string,
  from: DeploymentStatus,
  to: DeploymentStatus,
  patch: { error?: string | null } = {},
): void {
  assertTransition(from, to);
  const now = new Date();
  const isTerminal = isTerminalStatus(to);
  db.update(deployments)
    .set({
      status: to,
      error: patch.error ?? null,
      ...(to === "building" ? { startedAt: now } : {}),
      ...(isTerminal ? { finishedAt: now } : {}),
    })
    .where(eq(deployments.id, id))
    .run();
}

export function setDeploymentImage(
  id: string,
  patch: { imageTag?: string | null; commitSha?: string | null },
): void {
  db.update(deployments)
    .set({
      ...(patch.imageTag !== undefined ? { imageTag: patch.imageTag } : {}),
      ...(patch.commitSha !== undefined ? { commitSha: patch.commitSha } : {}),
    })
    .where(eq(deployments.id, id))
    .run();
}

/** Marks deployments left in-flight by a process restart as failed. */
export function failStaleDeployments(): number {
  const stale = db
    .select({ id: deployments.id, status: deployments.status })
    .from(deployments)
    .where(inArray(deployments.status, ["queued", "building", "starting"]))
    .all();
  for (const row of stale) {
    db.update(deployments)
      .set({
        status: "failed",
        error: "Panel restarted while the deployment was in progress.",
        finishedAt: new Date(),
      })
      .where(eq(deployments.id, row.id))
      .run();
  }
  return stale.length;
}

export function deleteDeploymentsForApp(appId: string): void {
  db.delete(deployments).where(eq(deployments.appId, appId)).run();
}
