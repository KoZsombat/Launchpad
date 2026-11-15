import type { AppContainer } from "@launchpad/shared";
import type { Readable } from "node:stream";
import type { AppRow } from "../db/schema";
import { docker } from "./client";
import { listAppContainerDetails } from "./containers";
import { ApiError } from "../lib/errors";
import { getSshCredentials, type SshCredentials } from "../services/settings";
import { shellQuote, sshRun, sshShell } from "../lib/ssh";

/** Shell inside a container, local (Docker exec) or on a remote host (SSH + docker exec). */
export interface AppShell {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
}

export interface AppShellHandlers {
  onData: (chunk: Buffer) => void;
  onExit: () => void;
}

const SHELL = ["/bin/sh"];

function isRemote(app: AppRow): boolean {
  return app.deployTarget === "remote";
}

function requireSsh(): SshCredentials {
  const credentials = getSshCredentials();
  if (!credentials) {
    throw new ApiError(
      409,
      "This project runs on a separate host, but SSH is not configured. Add the host credentials in Settings.",
    );
  }
  return credentials;
}

function toAppContainer(value: unknown): AppContainer | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.Id === "string" ? record.Id : null;
  if (!id) return null;
  const state = record.State as Record<string, unknown> | undefined;
  const config = record.Config as Record<string, unknown> | undefined;
  const labels = config?.Labels as Record<string, unknown> | undefined;
  const service = labels?.["com.docker.compose.service"];
  return {
    id,
    name:
      typeof record.Name === "string" ? record.Name.replace(/^\//, "") : id.slice(0, 12),
    state: typeof state?.Status === "string" ? state.Status : "unknown",
    image: typeof config?.Image === "string" ? config.Image : "",
    service: typeof service === "string" ? service : null,
  };
}

export async function listAppContainersForTarget(app: AppRow): Promise<AppContainer[]> {
  if (!isRemote(app)) return listAppContainerDetails(app.id);

  const ssh = requireSsh();
  const { stdout: idOutput } = await sshRun(
    ssh,
    `docker ps -aq --filter ${shellQuote(`label=launchpad.app=${app.id}`)}`,
    { timeoutMs: 30_000 },
  );
  const ids = idOutput.split(/\s+/).filter(Boolean);
  if (ids.length === 0) return [];

  const { stdout } = await sshRun(
    ssh,
    `docker inspect ${ids.map((id) => shellQuote(id)).join(" ")}`,
    { timeoutMs: 30_000 },
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new ApiError(502, "Could not read the container list from the remote host.");
  }
  if (!Array.isArray(parsed)) {
    throw new ApiError(502, "Could not read the container list from the remote host.");
  }
  return parsed
    .map(toAppContainer)
    .filter((container): container is AppContainer => container !== null);
}

export async function requireAppContainer(
  app: AppRow,
  containerId: string,
): Promise<AppContainer> {
  const containers = await listAppContainersForTarget(app);
  const container = containers.find((candidate) => candidate.id === containerId);
  if (!container) throw new ApiError(404, "That container does not belong to this app.");
  if (container.state !== "running") throw new ApiError(409, "The container is not running.");
  return container;
}

export async function openAppShell(
  app: AppRow,
  containerId: string,
  size: { cols: number; rows: number },
  handlers: AppShellHandlers,
): Promise<AppShell> {
  if (isRemote(app)) {
    const ssh = requireSsh();
    return sshShell(ssh, {
      command: `docker exec -it ${shellQuote(containerId)} ${SHELL.join(" ")}`,
      cols: size.cols,
      rows: size.rows,
      onData: handlers.onData,
      onClose: handlers.onExit,
    });
  }

  const exec = await docker.getContainer(containerId).exec({
    Cmd: SHELL,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
  });
  const stream = await exec.start({ hijack: true, stdin: true, Tty: true });
  let exited = false;
  const exit = (): void => {
    if (exited) return;
    exited = true;
    handlers.onExit();
  };
  stream.on("data", (chunk: Buffer) => handlers.onData(chunk));
  stream.on("end", exit);
  stream.on("close", exit);
  stream.on("error", exit);

  return {
    write(data) {
      if (!stream.destroyed) stream.write(data);
    },
    resize(cols, rows) {
      void exec.resize({ h: rows, w: cols }).catch(() => undefined);
    },
    close() {
      stream.destroy();
      exit();
    },
  };
}

/** Copies a staged tar archive rooted at `/` into the container. */
export async function uploadAppFile(
  app: AppRow,
  containerId: string,
  archive: Readable,
): Promise<void> {
  if (isRemote(app)) {
    const ssh = requireSsh();
    // `docker cp -` reads a tar from stdin; entries are rooted at / so directories are created.
    await sshRun(ssh, `docker cp - ${shellQuote(`${containerId}:/`)}`, {
      input: archive,
      timeoutMs: 600_000,
    });
    return;
  }
  await docker.getContainer(containerId).putArchive(archive, { path: "/" });
}
