import type { DeploymentStatus, DeployTarget } from "@launchpad/shared";
import { config } from "../config";
import { docker } from "../docker/client";
import { ensureVolume } from "../docker/containers";
import {
  ensureDockerNetwork,
  runComposeLocal,
  streamComposeLocal,
  waitForLocalComposeHealthy,
  waitForRemoteComposeHealthy,
} from "../docker/compose";
import type { AppRow } from "../db/schema";
import { ApiError } from "../lib/errors";
import { shellQuote, sshRun, sshStream } from "../lib/ssh";
import { generateComposeFile } from "./compose";
import { readRepoCompose } from "./source";
import { getServiceEnvMap, getEnvMap, setAppDeployed } from "../services/apps";
import { getSshCredentials, getBaseDomain, type SshCredentials } from "../services/settings";
import { setDeploymentImage } from "../services/deployments";

export function composeProjectName(appId: string): string {
  return `launchpad-${appId.slice(0, 8)}`;
}

export function storeComposeProject(target: DeployTarget, project: string): string {
  return `${target}:${project}`;
}

export function parseComposeProject(value: string | null): {
  target: DeployTarget | null;
  project: string | null;
} {
  if (!value) return { target: null, project: null };
  const separator = value.indexOf(":");
  if (separator > 0) {
    const prefix = value.slice(0, separator);
    if (prefix === "local" || prefix === "remote") {
      return { target: prefix, project: value.slice(separator + 1) };
    }
  }
  return { target: null, project: value };
}

function requireSsh(): SshCredentials {
  const credentials = getSshCredentials();
  if (!credentials) {
    throw new ApiError(
      409,
      "This project targets a separate host, but SSH is not configured. Add the host, username and password or key in Settings, or deploy the project locally.",
    );
  }
  return credentials;
}

export interface ComposeDeployContext {
  app: AppRow;
  deploymentId: string;
  log: (line: string) => void;
  transition: (to: DeploymentStatus) => void;
}

async function ensureLocalVolumes(names: string[], appId: string, log: (line: string) => void): Promise<void> {
  for (const name of names) {
    await ensureVolume(name, appId);
    log(`Volume ${name} ready.`);
  }
}

async function ensureRemoteVolumes(
  credentials: SshCredentials,
  names: string[],
  appId: string,
  log: (line: string) => void,
): Promise<void> {
  for (const name of names) {
    await sshRun(
      credentials,
      `docker volume create --label ${shellQuote(`launchpad.app=${appId}`)} ${shellQuote(name)}`,
      { log },
    );
    log(`Remote volume ${name} ready.`);
  }
}

async function downRemote(
  credentials: SshCredentials,
  project: string,
  log: (line: string) => void,
): Promise<void> {
  await sshRun(
    credentials,
    `docker compose -p ${shellQuote(project)} down --remove-orphans`,
    { log, timeoutMs: 120_000 },
  );
}

/** stop/start a compose project on either the panel host or a remote host. */
async function composeProjectAction(
  target: DeployTarget,
  project: string,
  action: "stop" | "start",
  credentials: SshCredentials | null,
  log: (line: string) => void,
): Promise<void> {
  if (target === "remote") {
    const ssh = credentials ?? requireSsh();
    await sshRun(ssh, `docker compose -p ${shellQuote(project)} ${action}`, {
      log,
      timeoutMs: 120_000,
    });
    return;
  }
  await runComposeLocal([action], { project, log, timeoutMs: 120_000 });
}

export async function deployComposeProject(context: ComposeDeployContext): Promise<void> {
  const { app, deploymentId, log, transition } = context;
  const target = app.deployTarget;
  const credentials = target === "remote" ? requireSsh() : null;

  const source = app.repoUrl
    ? await readRepoCompose(app, log)
    : { text: app.composeFile, sha: null, path: app.composePath, projectDir: undefined };
  if (!source.text) {
    throw new Error("This project has no compose file. Re-import it before deploying.");
  }
  log(
    app.repoUrl
      ? `Using compose file "${source.path ?? app.composePath ?? "compose"}" from ${app.repoUrl}.`
      : "Using the compose file stored with the project.",
  );

  const generated = generateComposeFile({
    compose: source.text,
    appId: app.id,
    baseDomain: app.domain ?? getBaseDomain(),
    deploymentId,
    projectName: composeProjectName(app.id),
    network: config.dockerNetwork,
    volumePrefix: `launchpad-${app.id.slice(0, 8)}-`,
    services: app.composeServices.map((service) => ({
      name: service.name,
      expose: service.expose,
      subdomains: service.subdomains,
      internalPort: service.internalPort,
      healthPath: service.healthPath,
      env: getServiceEnvMap(service),
    })),
    env: getEnvMap(app),
    remote: target === "remote",
    allowBuild: Boolean(app.repoUrl),
    log,
  });
  for (const warning of generated.warnings) log(`Compose warning: ${warning}`);

  setDeploymentImage(deploymentId, {
    imageTag: "compose",
    commitSha: source.sha ?? null,
  });

  const project = composeProjectName(app.id);
  const stored = storeComposeProject(target, project);
  const previous = parseComposeProject(app.composeProject);
  const previousProject = previous.project;
  const previousTarget = previous.target ?? target;
  const previousSharesHost = Boolean(
    previousProject && previousProject !== project && previousTarget === target,
  );
  let stoppedPrevious: string | null = null;

  try {
    transition("starting");
    if (previousSharesHost && previousProject) {
      log(`Stopping previous compose project ${previousProject} before recreating shared volumes...`);
      await composeProjectAction(
        previousTarget,
        previousProject,
        "stop",
        credentials,
        log,
      ).catch((error) => {
        log(
          `Could not stop the previous compose project: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
      stoppedPrevious = previousProject;
    }
    if (credentials) {
      await sshRun(
        credentials,
        `docker network inspect ${shellQuote(config.dockerNetwork)} >/dev/null 2>&1 || docker network create ${shellQuote(config.dockerNetwork)}`,
        { log },
      );
      await ensureRemoteVolumes(credentials, generated.volumes, app.id, log);
      log(`Starting compose project ${project} on ${credentials.host}...`);
      await sshRun(
        credentials,
        `docker compose -p ${shellQuote(project)} -f - up -d --remove-orphans`,
        { input: generated.yaml, log, timeoutMs: 15 * 60 * 1_000 },
      );
      await waitForRemoteComposeHealthy({
        project,
        services: generated.serviceNames,
        routed: generated.routedServices,
        timeoutMs: config.healthTimeoutMs,
        intervalMs: config.healthIntervalMs,
        log,
        query: async () => {
          const { stdout } = await sshRun(
            credentials,
            `docker compose -p ${shellQuote(project)} ps --format json`,
            { timeoutMs: 30_000 },
          );
          return stdout;
        },
      });
    } else {
      await ensureDockerNetwork(config.dockerNetwork);
      await ensureLocalVolumes(generated.volumes, app.id, log);
      log(`Starting compose project ${project} on the panel host...`);
      await runComposeLocal(["up", "-d", "--remove-orphans"], {
        project,
        input: generated.yaml,
        projectDir: source.projectDir,
        log,
        timeoutMs: 15 * 60 * 1_000,
      });
      await waitForLocalComposeHealthy({
        project,
        network: config.dockerNetwork,
        routed: generated.routedServices,
        services: generated.serviceNames,
        timeoutMs: config.healthTimeoutMs,
        intervalMs: config.healthIntervalMs,
        log,
      });
    }

    transition("healthy");
    setAppDeployed(app.id, null, "compose", "running", stored);

    if (previousProject && previousProject !== project) {
      await removeComposeProject(
        app.id,
        previousTarget,
        previousProject,
        false,
        false,
        log,
      ).catch((error) => {
        log(
          `Could not remove the previous compose project: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }
    log(
      target === "local"
        ? "Compose project is healthy. Traffic is routed through Traefik."
        : "Compose project is healthy on the remote host.",
    );
  } catch (error) {
    log(`Compose deployment failed: ${error instanceof Error ? error.message : String(error)}`);
    log("Collecting container logs before cleanup...");
    try {
      const prefixed = (line: string) => log(`  ${line}`);
      if (credentials) {
        await sshRun(
          credentials,
          `docker compose -p ${shellQuote(project)} logs --no-color --tail 80`,
          { log: prefixed, timeoutMs: 45_000 },
        );
      } else {
        await runComposeLocal(["logs", "--no-color", "--tail", "80"], {
          project,
          log: prefixed,
          timeoutMs: 45_000,
        });
      }
    } catch (logError) {
      log(
        `Could not collect container logs: ${
          logError instanceof Error ? logError.message : String(logError)
        }`,
      );
    }
    await removeComposeProject(app.id, target, project, false, true, log).catch((cleanupError) => {
      log(
        `Could not remove the failed compose project: ${
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        }`,
      );
    });
    if (stoppedPrevious) {
      log(`Restarting previous compose project ${stoppedPrevious} after the failure...`);
      await composeProjectAction(target, stoppedPrevious, "start", credentials, log).catch(
        (restartError) => {
          log(
            `Could not restart the previous compose project: ${
              restartError instanceof Error ? restartError.message : String(restartError)
            }`,
          );
        },
      );
    }
    throw error;
  }
}

async function removeComposeProject(
  appId: string,
  target: DeployTarget,
  project: string,
  removeVolumes: boolean,
  silent: boolean,
  log: (line: string) => void,
): Promise<void> {
  if (target === "remote") {
    const credentials = requireSsh();
    await downRemote(credentials, project, log);
    if (removeVolumes) {
      const { stdout } = await sshRun(
        credentials,
        `docker volume ls -q --filter ${shellQuote(`label=launchpad.app=${appId}`)}`,
        { log },
      );
      const names = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (names.length > 0) {
        await sshRun(
          credentials,
          `docker volume rm -f ${names.map((name) => shellQuote(name)).join(" ")}`,
          { log },
        );
      }
    }
    if (!silent) log(`Removed remote compose project ${project}.`);
    return;
  }
  await runComposeLocal(["down", "--remove-orphans", "--volumes"], {
    project,
    log,
    timeoutMs: 120_000,
  });
  if (removeVolumes) {
    const volumes = await docker.listVolumes({
      filters: { label: [`launchpad.app=${appId}`] },
    });
    for (const volume of volumes.Volumes ?? []) {
      if (!volume.Name) continue;
      await docker.getVolume(volume.Name).remove().catch(() => undefined);
    }
  }
  if (!silent) log(`Removed compose project ${project}.`);
}

export async function removeComposeProjectByValue(
  app: AppRow,
  value: string,
  removeVolumes: boolean,
  log: (line: string) => void,
): Promise<void> {
  const parsed = parseComposeProject(value);
  if (!parsed.project) return;
  const target = parsed.target ?? app.deployTarget;
  await removeComposeProject(app.id, target, parsed.project, removeVolumes, false, log);
}

export async function removeComposeProjectForApp(
  app: AppRow,
  removeVolumes: boolean,
  log: (line: string) => void,
): Promise<void> {
  if (app.composeProject) {
    await removeComposeProjectByValue(app, app.composeProject, removeVolumes, log);
    return;
  }
  if (removeVolumes) {
    if (app.deployTarget === "remote") {
      const credentials = requireSsh();
      const { stdout } = await sshRun(
        credentials,
        `docker volume ls -q --filter ${shellQuote(`label=launchpad.app=${app.id}`)}`,
      );
      const names = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (names.length > 0) {
        await sshRun(credentials, `docker volume rm -f ${names.map((name) => shellQuote(name)).join(" ")}`);
      }
      return;
    }
    const volumes = await docker.listVolumes({
      filters: { label: [`launchpad.app=${app.id}`] },
    });
    for (const volume of volumes.Volumes ?? []) {
      if (!volume.Name) continue;
      await docker.getVolume(volume.Name).remove().catch(() => undefined);
    }
  }
}

export async function composeLifecycle(
  app: AppRow,
  action: "restart" | "stop" | "start",
): Promise<void> {
  const parsed = parseComposeProject(app.composeProject);
  if (!parsed.project) throw new ApiError(409, "This project has not been deployed yet.");
  const target = parsed.target ?? app.deployTarget;
  if (target === "remote") {
    const credentials = requireSsh();
    await sshRun(
      credentials,
      `docker compose -p ${shellQuote(parsed.project)} ${action}`,
      { timeoutMs: 120_000 },
    );
    return;
  }
  await runComposeLocal([action], {
    project: parsed.project,
    log: () => undefined,
    timeoutMs: 120_000,
  });
}

export async function followComposeLogs(
  app: AppRow,
  onLine: (line: string) => void,
): Promise<() => void> {
  const parsed = parseComposeProject(app.composeProject);
  if (!parsed.project) throw new ApiError(409, "This project has not been deployed yet.");
  const target = parsed.target ?? app.deployTarget;
  if (target === "remote") {
    const credentials = requireSsh();
    return sshStream(
      credentials,
      `docker compose -p ${shellQuote(parsed.project)} logs --follow --no-color --tail 200`,
      { onLine },
    );
  }
  return streamComposeLocal(parsed.project, onLine);
}
