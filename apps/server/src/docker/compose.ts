import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { docker } from "./client";
import { containerIp, dockerErrorStatus } from "./containers";

function lineSplitter(onLine: (line: string) => void): (chunk: Buffer) => void {
  let buffer = "";
  return (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.replace(/\r/g, "").trimEnd();
      if (trimmed) onLine(trimmed);
    }
  };
}

export interface RunComposeOptions {
  project: string;
  log: (line: string) => void;
  input?: string;
  timeoutMs?: number;
  /** Base directory for relative build contexts and env files. */
  projectDir?: string;
}

// The CLI only needs its socket and a home for registry credentials. Passing the
// panel's full environment would leak encryption keys and tokens to a child process.
const DOCKER_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  DOCKER_HOST: process.env.DOCKER_HOST ?? "unix:///var/run/docker.sock",
  ...(process.env.DOCKER_CONFIG ? { DOCKER_CONFIG: process.env.DOCKER_CONFIG } : {}),
};

/** Runs `docker compose -p <project> …` against the panel's Docker socket. */
export function runComposeLocal(
  args: string[],
  options: RunComposeOptions,
): Promise<{ stdout: string; stderr: string }> {
  const completion = Promise.withResolvers<{ stdout: string; stderr: string }>();
  const child = spawn(
    "docker",
    [
      "compose",
      "-p",
      options.project,
      ...(options.projectDir ? ["--project-directory", options.projectDir] : []),
      ...(options.input !== undefined ? ["-f", "-"] : []),
      ...args,
    ],
    { env: DOCKER_ENV, stdio: ["pipe", "pipe", "pipe"] },
  );
  const out = lineSplitter(options.log);
  const err = lineSplitter(options.log);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
    out(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
    err(chunk);
  });
  const timer = setTimeout(() => {
    child.kill("SIGTERM");
  }, options.timeoutMs ?? 15 * 60 * 1_000);
  timer.unref?.();
  child.stdin.on("error", () => undefined);
  child.on("error", (error) => {
    clearTimeout(timer);
    completion.reject(error);
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    if (code === 0) {
      completion.resolve({ stdout, stderr });
      return;
    }
    const detail = stderr.trim().split("\n").slice(-6).join("\n");
    completion.reject(
      new Error(`docker compose ${args[0] ?? ""} failed (exit ${code})${detail ? `: ${detail}` : "."}`),
    );
  });
  if (options.input !== undefined) child.stdin.end(options.input);
  else child.stdin.end();
  return completion.promise;
}

/** Streams `docker compose logs -f` until the returned function is called. */
export async function streamComposeLocal(
  project: string,
  onLine: (line: string) => void,
): Promise<() => void> {
  const child = spawn(
    "docker",
    ["compose", "-p", project, "logs", "--follow", "--no-color", "--tail", "200"],
    { env: DOCKER_ENV, stdio: ["ignore", "pipe", "pipe"] },
  );
  const push = lineSplitter(onLine);
  child.stdout.on("data", push);
  child.stderr.on("data", push);
  child.on("error", (error) => onLine(`compose logs error: ${error.message}`));
  return () => {
    child.kill("SIGTERM");
  };
}

export async function ensureDockerNetwork(name: string): Promise<void> {
  try {
    await docker.getNetwork(name).inspect();
  } catch (error) {
    if (dockerErrorStatus(error) !== 404) throw error;
    await docker.createNetwork({ Name: name });
  }
}

export interface ComposeContainer {
  id: string;
  service: string;
  state: string;
}

export async function composeProjectContainers(project: string): Promise<ComposeContainer[]> {
  const containers = await docker.listContainers({
    all: true,
    filters: { label: [`com.docker.compose.project=${project}`] },
  });
  return containers.map((container) => ({
    id: container.Id,
    service: container.Labels?.["com.docker.compose.service"] ?? "",
    state: container.State ?? "unknown",
  }));
}

async function probeHealth(ip: string, port: number, path: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`http://${ip}:${port}${path}`, {
      signal: controller.signal,
      redirect: "manual",
    });
    if (response.status >= 200 && response.status < 400) return null;
    return `HTTP ${response.status}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(timer);
  }
}

export interface LocalComposeHealthOptions {
  project: string;
  network: string;
  routed: { name: string; internalPort: number; healthPath: string }[];
  services: string[];
  timeoutMs: number;
  intervalMs: number;
  log: (line: string) => void;
}

/** Waits until every service runs; routed services must answer their health path. */
export async function waitForLocalComposeHealthy(options: LocalComposeHealthOptions): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  let attempt = 0;
  let lastError = "containers did not start";
  await delay(1_000);

  while (Date.now() < deadline) {
    attempt += 1;
    const containers = await composeProjectContainers(options.project);
    const byService = new Map(containers.map((container) => [container.service, container]));
    const problems: string[] = [];

    for (const service of options.services) {
      const container = byService.get(service);
      if (!container) {
        problems.push(`${service}: not created`);
        continue;
      }
      if (container.state !== "running") {
        problems.push(`${service}: ${container.state}`);
        continue;
      }
      const routed = options.routed.find((entry) => entry.name === service);
      if (!routed) continue;
      const ip = await containerIp(container.id, options.network);
      if (!ip) {
        problems.push(`${service}: not attached to ${options.network}`);
        continue;
      }
      const error = await probeHealth(ip, routed.internalPort, routed.healthPath);
      if (error) problems.push(`${service}: ${error}`);
    }

    if (problems.length === 0) {
      options.log("All compose services are running and routed services are healthy.");
      return;
    }
    lastError = problems.join("; ");
    if (attempt === 1 || attempt % 5 === 0) {
      options.log(`Compose health attempt ${attempt} failed (${lastError}); retrying...`);
    }
    await delay(options.intervalMs);
  }

  throw new Error(
    `Compose project did not become healthy within ${Math.round(options.timeoutMs / 1_000)}s (${lastError}).`,
  );
}

export interface ComposePsEntry {
  service: string;
  state: string;
  health: string;
}

/** Parses `docker compose ps --format json` (array or JSON-lines, depending on version). */
export function parseComposePs(raw: string): ComposePsEntry[] {
  const text = raw.trim();
  if (!text) return [];
  const toEntry = (value: unknown): ComposePsEntry | null => {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const service = record.Service ?? record.service;
    if (typeof service !== "string") return null;
    return {
      service,
      state: String(record.State ?? record.state ?? ""),
      health: String(record.Health ?? record.health ?? ""),
    };
  };
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map(toEntry).filter((entry): entry is ComposePsEntry => entry !== null);
    }
    const single = toEntry(parsed);
    if (single) return [single];
  } catch {
    // Fall back to JSON lines.
  }
  return text
    .split("\n")
    .map((line) => {
      try {
        return toEntry(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter((entry): entry is ComposePsEntry => entry !== null);
}

export interface RemoteComposeHealthOptions {
  project: string;
  routed: { name: string; internalPort: number; healthPath: string }[];
  services: string[];
  timeoutMs: number;
  intervalMs: number;
  log: (line: string) => void;
  query: () => Promise<string>;
}

/** Waits for `docker compose ps` on a remote host to report every service running. */
export async function waitForRemoteComposeHealthy(
  options: RemoteComposeHealthOptions,
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  let attempt = 0;
  let lastError = "no compose state";
  await delay(1_500);

  while (Date.now() < deadline) {
    attempt += 1;
    const raw = await options.query();
    const entries = parseComposePs(raw);
    const byService = new Map(entries.map((entry) => [entry.service, entry]));
    const problems: string[] = [];
    for (const service of options.services) {
      const entry = byService.get(service);
      if (!entry) {
        problems.push(`${service}: not created`);
        continue;
      }
      if (entry.state !== "running") {
        problems.push(`${service}: ${entry.state || "unknown"}`);
        continue;
      }
      if (entry.health && entry.health !== "healthy") {
        problems.push(`${service}: health ${entry.health}`);
      }
    }
    if (problems.length === 0) {
      options.log("All remote compose services are running.");
      return;
    }
    lastError = problems.join("; ");
    if (attempt === 1 || attempt % 5 === 0) {
      options.log(`Remote compose health attempt ${attempt} failed (${lastError}); retrying...`);
    }
    await delay(options.intervalMs);
  }
  throw new Error(
    `Remote compose project did not become healthy within ${Math.round(options.timeoutMs / 1_000)}s (${lastError}).`,
  );
}
