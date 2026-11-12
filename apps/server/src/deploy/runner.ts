import type { DeploymentStatus, DeploymentTrigger } from "@launchpad/shared";
import { buildTraefikLabels } from "@launchpad/shared";
import { config } from "../config";
import {
  containerIsRunning,
  createAndStartAppContainer,
  ensureVolume,
  listAppContainers,
  removeContainer,
  waitForHealthy,
} from "../docker/containers";
import { pullImage } from "../docker/images";
import { getAppRow, getEnvMap, getRegistryPassword, requireAppRow, setAppDeployed, setAppStatus } from "../services/apps";
import {
  createDeploymentRow,
  getDeploymentRow,
  setDeploymentImage,
  updateDeploymentStatus,
} from "../services/deployments";
import { getBaseDomain, getGhcrCredentials } from "../services/settings";
import type { AppRow, DeploymentRow } from "../db/schema";
import {
  appendDeploymentLog,
  finishDeploymentLog,
  setDeploymentStreamStatus,
} from "./logs";
import { buildImageFromRepo } from "./source";

export interface DeploymentOptions {
  imageTag?: string | null;
  commitSha?: string | null;
}

function credentialsFor(app: AppRow, imageTag: string) {
  if (imageTag.startsWith("ghcr.io/")) return getGhcrCredentials();
  const username = app.registryUsername;
  const password = getRegistryPassword(app);
  if (username && password) return { username, password };
  return null;
}

async function resolveImage(
  app: AppRow,
  deploymentId: string,
  options: DeploymentOptions,
  log: (line: string) => void,
): Promise<{ imageTag: string; commitSha: string | null }> {
  if (options.imageTag) {
    log(`Using image supplied by CI: ${options.imageTag}`);
    await pullImage(options.imageTag, credentialsFor(app, options.imageTag), log);
    return { imageTag: options.imageTag, commitSha: options.commitSha ?? null };
  }

  if (app.sourceType === "image") {
    if (!app.imageRef) throw new Error("This app has no image reference configured.");
    await pullImage(app.imageRef, credentialsFor(app, app.imageRef), log);
    return { imageTag: app.imageRef, commitSha: null };
  }

  const built = await buildImageFromRepo(app, log);
  setDeploymentImage(deploymentId, { imageTag: built.imageTag, commitSha: built.commitSha });
  return { imageTag: built.imageTag, commitSha: built.commitSha };
}

async function cleanupOtherContainers(
  appId: string,
  keepContainerId: string,
  log: (line: string) => void,
): Promise<void> {
  const containers = await listAppContainers(appId);
  for (const container of containers) {
    if (container.id === keepContainerId) continue;
    try {
      await removeContainer(container.id);
      log(`Removed old container ${container.id.slice(0, 12)}.`);
    } catch (error) {
      log(
        `Could not remove container ${container.id.slice(0, 12)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

export async function runDeployment(
  deploymentId: string,
  appId: string,
  options: DeploymentOptions = {},
): Promise<void> {
  const deployment = getDeploymentRow(deploymentId);
  if (!deployment) return;

  const log = (line: string) => appendDeploymentLog(deploymentId, line);
  let status: DeploymentStatus = deployment.status;
  const transition = (to: DeploymentStatus, error?: string) => {
    updateDeploymentStatus(deploymentId, status, to, { error: error ?? null });
    status = to;
    setDeploymentStreamStatus(deploymentId, to);
  };

  let newContainerId: string | null = null;

  try {
    const app = requireAppRow(appId);
    transition("building");
    log(`Starting deployment ${deploymentId.slice(0, 8)} (${options.imageTag ? "CI image" : app.sourceType}).`);

    const resolved = await resolveImage(app, deploymentId, options, log);
    setDeploymentImage(deploymentId, {
      imageTag: resolved.imageTag,
      commitSha: resolved.commitSha,
    });

    transition("starting");
    const appWithUpdatedConfig = getAppRow(appId) ?? app;
    for (const volume of appWithUpdatedConfig.volumes) {
      await ensureVolume(volume.volumeName, appId);
      log(`Volume ${volume.volumeName} ready.`);
    }

    const labels = {
      ...buildTraefikLabels({
        appId,
        subdomain: appWithUpdatedConfig.subdomain,
        baseDomain: getBaseDomain(),
        port: appWithUpdatedConfig.internalPort,
        healthPath: appWithUpdatedConfig.healthPath,
        network: config.dockerNetwork,
      }),
      "launchpad.app": appId,
      "launchpad.deployment": deploymentId,
      "launchpad.managed": "true",
    };

    newContainerId = await createAndStartAppContainer({
      name: `launchpad-${appWithUpdatedConfig.name}-${deploymentId.slice(0, 8)}`,
      image: resolved.imageTag,
      env: getEnvMap(appWithUpdatedConfig),
      labels,
      network: config.dockerNetwork,
      port: appWithUpdatedConfig.internalPort,
      volumes: appWithUpdatedConfig.volumes,
    });
    log(`Container ${newContainerId.slice(0, 12)} started; waiting for health.`);

    await waitForHealthy({
      containerId: newContainerId,
      network: config.dockerNetwork,
      port: appWithUpdatedConfig.internalPort,
      path: appWithUpdatedConfig.healthPath,
      timeoutMs: config.healthTimeoutMs,
      intervalMs: config.healthIntervalMs,
      log,
    });

    transition("healthy");
    setAppDeployed(appId, newContainerId, resolved.imageTag);

    const oldContainerId = app.containerId;
    if (oldContainerId && oldContainerId !== newContainerId) {
      try {
        await removeContainer(oldContainerId);
        log(`Removed previous container ${oldContainerId.slice(0, 12)}.`);
      } catch (error) {
        log(
          `Could not remove previous container: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    await cleanupOtherContainers(appId, newContainerId, log);
    log("Deployment healthy. Traffic is now routed to the new container.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Deployment failed: ${message}`);
    try {
      const current = getDeploymentRow(deploymentId);
      if (current && current.status !== "healthy" && current.status !== "failed") {
        updateDeploymentStatus(deploymentId, current.status, "failed", { error: message });
        status = "failed";
        setDeploymentStreamStatus(deploymentId, "failed");
      }
    } catch (transitionError) {
      log(
        `Could not record failure state: ${
          transitionError instanceof Error ? transitionError.message : String(transitionError)
        }`,
      );
    }

    if (newContainerId) {
      try {
        await removeContainer(newContainerId);
        log("Removed failed container; the previous version was kept running.");
      } catch (removeError) {
        log(
          `Could not remove failed container: ${
            removeError instanceof Error ? removeError.message : String(removeError)
          }`,
        );
      }
    }

    const app = getAppRow(appId);
    if (app) {
      const oldContainerStillRunning = app.containerId
        ? await containerIsRunning(app.containerId).catch(() => false)
        : false;
      if (!oldContainerStillRunning) setAppStatus(appId, "failed");
    }
  } finally {
    finishDeploymentLog(deploymentId);
  }
}

class DeploymentQueue {
  private tails = new Map<string, Promise<void>>();

  enqueue(appId: string, deploymentId: string, options: DeploymentOptions): void {
    const previous = this.tails.get(appId) ?? Promise.resolve();
    const next = previous
      .then(() => runDeployment(deploymentId, appId, options))
      .catch((error) => {
        console.error(`Deployment ${deploymentId} crashed:`, error);
        appendDeploymentLog(
          deploymentId,
          `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        );
        finishDeploymentLog(deploymentId);
      });
    this.tails.set(appId, next);
    void next.finally(() => {
      if (this.tails.get(appId) === next) this.tails.delete(appId);
    });
  }
}

export const deploymentQueue = new DeploymentQueue();

export function enqueueDeployment(
  appId: string,
  trigger: DeploymentTrigger,
  options: DeploymentOptions = {},
): DeploymentRow {
  const deployment = createDeploymentRow(appId, trigger, {
    imageTag: options.imageTag ?? null,
    commitSha: options.commitSha ?? null,
  });
  setDeploymentStreamStatus(deployment.id, "queued");
  deploymentQueue.enqueue(appId, deployment.id, options);
  return deployment;
}
