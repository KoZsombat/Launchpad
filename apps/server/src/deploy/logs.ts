import { EventEmitter } from "node:events";
import type { DeploymentStatus } from "@launchpad/shared";
import { isTerminalStatus } from "@launchpad/shared";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { deployments } from "../db/schema";
import { getDeploymentRow } from "../services/deployments";

interface Channel {
  buffer: string;
  status: DeploymentStatus;
  emitter: EventEmitter;
  flushTimer: NodeJS.Timeout | null;
  cleanupTimer: NodeJS.Timeout | null;
}

const channels = new Map<string, Channel>();

function getChannel(deploymentId: string): Channel {
  const existing = channels.get(deploymentId);
  if (existing) return existing;
  const row = getDeploymentRow(deploymentId);
  const channel: Channel = {
    buffer: row?.log ?? "",
    status: row?.status ?? "queued",
    emitter: new EventEmitter(),
    flushTimer: null,
    cleanupTimer: null,
  };
  channel.emitter.setMaxListeners(50);
  channels.set(deploymentId, channel);
  return channel;
}

function flush(deploymentId: string, channel: Channel): void {
  if (channel.flushTimer) {
    clearTimeout(channel.flushTimer);
    channel.flushTimer = null;
  }
  db.update(deployments)
    .set({ log: channel.buffer })
    .where(eq(deployments.id, deploymentId))
    .run();
}

function scheduleFlush(deploymentId: string, channel: Channel): void {
  if (channel.flushTimer) return;
  channel.flushTimer = setTimeout(() => {
    channel.flushTimer = null;
    flush(deploymentId, channel);
  }, 1_000);
  channel.flushTimer.unref?.();
}

export function appendDeploymentLog(deploymentId: string, message: string): void {
  const channel = getChannel(deploymentId);
  const timestamp = new Date().toISOString().slice(11, 19);
  const line = `[${timestamp}] ${message}\n`;
  channel.buffer += line;
  channel.emitter.emit("log", line);
  scheduleFlush(deploymentId, channel);
}

export function setDeploymentStreamStatus(
  deploymentId: string,
  status: DeploymentStatus,
): void {
  const channel = getChannel(deploymentId);
  channel.status = status;
  channel.emitter.emit("status", status);
  if (isTerminalStatus(status)) {
    flush(deploymentId, channel);
    channel.cleanupTimer = setTimeout(() => {
      channels.delete(deploymentId);
    }, 10 * 60 * 1_000);
    channel.cleanupTimer.unref?.();
  }
}

export function finishDeploymentLog(deploymentId: string): void {
  const channel = channels.get(deploymentId);
  if (channel) flush(deploymentId, channel);
}

export interface DeploymentStreamSnapshot {
  log: string;
  status: DeploymentStatus;
}

export function getDeploymentStreamSnapshot(deploymentId: string): DeploymentStreamSnapshot {
  const channel = channels.get(deploymentId);
  if (channel) return { log: channel.buffer, status: channel.status };
  const row = getDeploymentRow(deploymentId);
  return { log: row?.log ?? "", status: row?.status ?? "failed" };
}

export function subscribeToDeployment(
  deploymentId: string,
  handlers: {
    onLog: (line: string) => void;
    onStatus: (status: DeploymentStatus) => void;
  },
): () => void {
  const channel = getChannel(deploymentId);
  const logListener = (line: string) => handlers.onLog(line);
  const statusListener = (status: DeploymentStatus) => handlers.onStatus(status);
  channel.emitter.on("log", logListener);
  channel.emitter.on("status", statusListener);
  return () => {
    channel.emitter.off("log", logListener);
    channel.emitter.off("status", statusListener);
  };
}
