import { setTimeout as delay } from "node:timers/promises";
import type { ResourceUsage } from "@launchpad/shared";
import { docker } from "./client";

export interface VolumeMount {
  containerPath: string;
  volumeName: string;
}

export async function ensureVolume(name: string, appId: string): Promise<void> {
  try {
    await docker.getVolume(name).inspect();
    return;
  } catch (error) {
    if (dockerErrorStatus(error) !== 404) throw error;
  }
  await docker.createVolume({ Name: name, Labels: { "launchpad.app": appId } });
}

export interface CreateAppContainerOptions {
  name: string;
  image: string;
  env: Record<string, string>;
  labels: Record<string, string>;
  network: string;
  port: number;
  /** Publish the internal port on this host port. Null keeps it internal-only. */
  hostPort?: number | null;
  protocol?: "tcp" | "udp";
  volumes: VolumeMount[];
}

export async function createAndStartAppContainer(
  options: CreateAppContainerOptions,
): Promise<string> {
  const protocol = options.protocol ?? "tcp";
  const portKey = `${options.port}/${protocol}`;
  const container = await docker.createContainer({
    name: options.name,
    Image: options.image,
    Env: Object.entries(options.env).map(([key, value]) => `${key}=${value}`),
    Labels: options.labels,
    ExposedPorts: { [portKey]: {} },
    HostConfig: {
      NetworkMode: options.network,
      RestartPolicy: { Name: "unless-stopped" },
      ...(options.hostPort
        ? { PortBindings: { [portKey]: [{ HostPort: String(options.hostPort) }] } }
        : {}),
      Binds: options.volumes.map(
        (mount) => `${mount.volumeName}:${mount.containerPath}`,
      ),
    },
  });
  await container.start();
  return container.id;
}

export async function containerIp(containerId: string, network: string): Promise<string | null> {
  const info = await docker.getContainer(containerId).inspect();
  return info.NetworkSettings.Networks?.[network]?.IPAddress || null;
}

export async function containerIsRunning(containerId: string): Promise<boolean> {
  try {
    const info = await docker.getContainer(containerId).inspect();
    return Boolean(info.State?.Running);
  } catch (error) {
    if (dockerErrorStatus(error) === 404) return false;
    throw error;
  }
}

export async function removeContainer(containerId: string): Promise<void> {
  try {
    await docker.getContainer(containerId).remove({ force: true });
  } catch (error) {
    if (dockerErrorStatus(error) !== 404) throw error;
  }
}

export async function stopContainer(containerId: string): Promise<void> {
  try {
    await docker.getContainer(containerId).stop({ t: 10 });
  } catch (error) {
    const status = dockerErrorStatus(error);
    // 304 = already stopped, 404 = gone. Both are fine for stop.
    if (status !== 304 && status !== 404) throw error;
  }
}

export async function startContainer(containerId: string): Promise<void> {
  try {
    await docker.getContainer(containerId).start();
  } catch (error) {
    if (dockerErrorStatus(error) !== 304) throw error;
  }
}

export async function restartContainer(containerId: string): Promise<void> {
  await docker.getContainer(containerId).restart({ t: 10 });
}

export async function listAppContainers(appId: string): Promise<{ id: string; state: string }[]> {
  const containers = await docker.listContainers({
    all: true,
    filters: { label: [`launchpad.app=${appId}`] },
  });
  return containers.map((container) => ({
    id: container.Id,
    state: container.State ?? "unknown",
  }));
}

export async function removeAppVolume(name: string): Promise<void> {
  try {
    await docker.getVolume(name).remove();
  } catch (error) {
    if (dockerErrorStatus(error) !== 404) throw error;
  }
}

export interface HealthCheckOptions {
  containerId: string;
  network: string;
  port: number;
  path: string;
  timeoutMs: number;
  intervalMs: number;
  log: (line: string) => void;
}

/** Polls the container's internal IP until the health path returns 2xx/3xx. */
export async function waitForHealthy(options: HealthCheckOptions): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  let attempt = 0;
  let lastError = "no response";

  // Containers need a moment before the first connection attempt is meaningful.
  await delay(750);

  while (Date.now() < deadline) {
    attempt += 1;
    const ip = await containerIp(options.containerId, options.network);
    if (ip) {
      const url = `http://${ip}:${options.port}${options.path}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(options.intervalMs + 2_000, 6_000));
      try {
        const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
        if (response.status >= 200 && response.status < 400) {
          options.log(`Health check passed: HTTP ${response.status} from ${url}`);
          return;
        }
        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      } finally {
        clearTimeout(timer);
      }
    } else {
      lastError = `container is not attached to network "${options.network}" yet`;
    }

    if (attempt === 1 || attempt % 5 === 0) {
      options.log(`Health check attempt ${attempt} failed (${lastError}); retrying...`);
    }
    await delay(options.intervalMs);
  }

  throw new Error(
    `Container did not become healthy within ${Math.round(options.timeoutMs / 1000)}s (${lastError}).`,
  );
}

interface DockerStatsSample {
  cpu_stats?: {
    cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: {
    cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  memory_stats?: {
    usage?: number;
    limit?: number;
    stats?: Record<string, number>;
  };
}

function computeContainerUsage(sample: DockerStatsSample): ResourceUsage {
  const cpu = sample.cpu_stats ?? {};
  const previous = sample.precpu_stats ?? {};
  const cpuDelta =
    (cpu.cpu_usage?.total_usage ?? 0) - (previous.cpu_usage?.total_usage ?? 0);
  const systemDelta =
    (cpu.system_cpu_usage ?? 0) - (previous.system_cpu_usage ?? 0);
  const cores = cpu.online_cpus ?? cpu.cpu_usage?.percpu_usage?.length ?? 1;
  const cpuPercent =
    systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * cores * 100 : 0;

  const rawMemory = sample.memory_stats?.usage ?? 0;
  const stats = sample.memory_stats?.stats ?? {};
  // cgroup v2 exposes inactive_file, v1 uses total_inactive_file/cache.
  const cache = stats.inactive_file ?? stats.total_inactive_file ?? stats.cache ?? 0;
  return {
    cpuPercent: Math.round(cpuPercent * 100) / 100,
    memoryBytes: Math.max(0, rawMemory - cache),
    memoryLimitBytes: sample.memory_stats?.limit ?? 0,
    containerCount: 1,
  };
}

/** One-shot CPU/RAM sample for a single container. */
export async function containerUsage(containerId: string): Promise<ResourceUsage | null> {
  try {
    const sample = await docker.getContainer(containerId).stats({ stream: false });
    return computeContainerUsage(sample as DockerStatsSample);
  } catch (error) {
    if (dockerErrorStatus(error) === 404) return null;
    throw error;
  }
}

/**
 * Sums live usage for one app's containers, or for every Launchpad-managed
 * container when `appId` is omitted.
 */
export async function aggregateContainerUsage(appId?: string): Promise<ResourceUsage> {
  const containers = await docker.listContainers({
    all: false,
    filters: {
      label: appId ? [`launchpad.app=${appId}`] : ["launchpad.managed=true"],
    },
  });
  const samples = await Promise.all(
    containers.map((container) => containerUsage(container.Id).catch(() => null)),
  );
  const total: ResourceUsage = {
    cpuPercent: 0,
    memoryBytes: 0,
    memoryLimitBytes: 0,
    containerCount: containers.length,
  };
  for (const sample of samples) {
    if (!sample) continue;
    total.cpuPercent += sample.cpuPercent;
    total.memoryBytes += sample.memoryBytes;
    total.memoryLimitBytes += sample.memoryLimitBytes;
  }
  total.cpuPercent = Math.round(total.cpuPercent * 100) / 100;
  return total;
}

export function dockerErrorStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const status = error.statusCode;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}
