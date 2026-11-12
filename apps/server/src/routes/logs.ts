import { Router } from "express";
import { isTerminalStatus } from "@launchpad/shared";
import { ApiError } from "../lib/errors";
import { requireParam } from "../lib/http";
import { openSse, sendSse, startSseHeartbeat } from "../lib/sse";
import {
  getDeploymentStreamSnapshot,
  subscribeToDeployment,
} from "../deploy/logs";
import { followContainerLogs } from "../docker/logs";
import { requireAppRow } from "../services/apps";
import { getDeploymentForApp } from "../services/deployments";

export const logsRouter = Router();

logsRouter.get("/apps/:id/deployments/:deploymentId/logs", (req, res) => {
  const appId = requireParam(req.params, "id");
  const deploymentId = requireParam(req.params, "deploymentId");
  requireAppRow(appId);
  const deployment = getDeploymentForApp(appId, deploymentId);
  if (!deployment) throw new ApiError(404, "Deployment not found.");

  openSse(res);
  const snapshot = getDeploymentStreamSnapshot(deployment.id);
  sendSse(res, "snapshot", { log: snapshot.log });
  sendSse(res, "status", { status: snapshot.status });

  let closed = false;
  let stopHeartbeat = (): void => {};
  let unsubscribe = (): void => {};

  const finish = (): void => {
    if (closed) return;
    closed = true;
    unsubscribe();
    stopHeartbeat();
    res.end();
  };

  if (isTerminalStatus(snapshot.status)) {
    res.end();
    return;
  }

  unsubscribe = subscribeToDeployment(deployment.id, {
    onLog: (line) => {
      if (!closed) sendSse(res, "log", { line });
    },
    onStatus: (status) => {
      if (closed) return;
      sendSse(res, "status", { status });
      if (isTerminalStatus(status)) finish();
    },
  });
  stopHeartbeat = startSseHeartbeat(res);
  req.on("close", finish);
});

logsRouter.get("/apps/:id/logs", async (req, res) => {
  const app = requireAppRow(requireParam(req.params, "id"));
  if (!app.containerId) throw new ApiError(409, "This app has not been deployed yet.");

  openSse(res);
  sendSse(res, "status", { containerId: app.containerId });

  let cleanup: (() => void) | null = null;
  try {
    cleanup = await followContainerLogs(app.containerId, (line) => {
      if (!res.writableEnded) sendSse(res, "log", { line });
    });
  } catch (error) {
    sendSse(res, "error", {
      message: error instanceof Error ? error.message : String(error),
    });
    res.end();
    return;
  }

  const stopHeartbeat = startSseHeartbeat(res);
  let closed = false;
  const finish = (): void => {
    if (closed) return;
    closed = true;
    stopHeartbeat();
    cleanup?.();
    res.end();
  };
  req.on("close", finish);
});
