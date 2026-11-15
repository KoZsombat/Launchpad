import { Router } from "express";
import { z } from "zod";
import { createAppSchema, scanComposeSchema, updateAppSchema } from "@launchpad/shared";
import { parseBody, requireParam } from "../lib/http";
import {
  checkAvailability,
  createApp,
  deleteAppRow,
  listAppRows,
  requireAppRow,
  setAppStatus,
  toPublicApp,
  updateApp,
} from "../services/apps";
import {
  listDeployments,
  getDeploymentForApp,
  serializeDeployment,
  serializeDeploymentDetail,
} from "../services/deployments";
import {
  getBaseDomain,
  getGithubToken,
  getSettingsView,
  getSshCredentials,
  getUploadLimitMb,
} from "../services/settings";
import { appWorkspacePath } from "../services/workspace";
import { enqueueDeployment } from "../deploy/runner";
import {
  restartContainer,
  startContainer,
  stopContainer,
  listAppContainers,
  removeContainer,
  removeAppVolume,
} from "../docker/containers";
import { normalizeHostDir, safeUploadName } from "../lib/paths";
import { sshUploadFile } from "../lib/ssh";
import { scanCompose } from "../deploy/compose";
import { fetchComposeFromRepo } from "../deploy/source";
import { composeLifecycle, removeComposeProjectForApp } from "../deploy/compose-runner";
import { ApiError } from "../lib/errors";
import { ghcrLatestImage } from "../lib/github";
import type { AppRow } from "../db/schema";

export const appsRouter = Router();

const availabilityQuerySchema = z.object({
  name: z.string().optional().default(""),
  subdomain: z.string().optional().default(""),
  domain: z.string().optional(),
});

appsRouter.get("/apps", (_req, res) => {
  const baseDomain = getBaseDomain();
  res.json({ apps: listAppRows().map((row) => toPublicApp(row, baseDomain)) });
});

appsRouter.get("/apps/availability", (req, res) => {
  const query = availabilityQuerySchema.parse(req.query);
  res.json(checkAvailability(query.name, query.subdomain, query.domain));
});

appsRouter.post("/apps/scan-compose", async (req, res) => {
  const input = parseBody(scanComposeSchema, req.body);
  let compose = input.compose ?? null;
  let composePath: string | null = input.composePath ?? null;
  if (input.repoUrl && input.branch) {
    try {
      const fetched = await fetchComposeFromRepo({
        repoUrl: input.repoUrl,
        branch: input.branch,
        token: input.repoToken ?? getGithubToken(),
        composePath: input.composePath ?? null,
        log: () => undefined,
      });
      compose = fetched.text;
      composePath = fetched.path;
    } catch (error) {
      throw new ApiError(
        422,
        `Could not read the compose file from the repository: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  if (!compose) throw new ApiError(400, "No compose file was supplied.");
  res.json({ compose, composePath, scan: scanCompose(compose) });
});

appsRouter.post("/apps", (req, res) => {
  const input = parseBody(createAppSchema, req.body);
  const row = createApp(input);
  const deployment = enqueueDeployment(row.id, "manual");
  res.status(201).json({
    app: toPublicApp(row, getBaseDomain()),
    deployment: serializeDeployment(deployment),
  });
});

function automaticRedeployOptions(app: AppRow): { imageTag?: string; commitSha?: string } {
  if (app.sourceType === "github" && app.cicdEnabled && app.repoUrl) {
    const latest = ghcrLatestImage(app.repoUrl);
    if (latest) return { imageTag: latest };
  }
  return {};
}

appsRouter.get("/apps/:id", (req, res) => {
  const app = requireAppRow(requireParam(req.params, "id"));
  res.json({ app: toPublicApp(app, getBaseDomain()) });
});

const uploadQuerySchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
});

/** Workspace directory the app terminal starts and uploads default to. */
appsRouter.get("/apps/:id/workspace", async (req, res) => {
  const app = requireAppRow(requireParam(req.params, "id"));
  res.json({
    workspace: await appWorkspacePath(app),
    uploadLimitMb: getUploadLimitMb(),
    sshHost: getSettingsView().sshHost,
  });
});

/** Copies a file from the browser onto the host that runs the app, over SFTP. */
appsRouter.post("/apps/:id/files", async (req, res) => {
  requireAppRow(requireParam(req.params, "id"));
  const query = parseBody(uploadQuerySchema, req.query);
  const directory = normalizeHostDir(query.path);
  const fileName = safeUploadName(query.name);
  if (!req.is("application/octet-stream")) {
    throw new ApiError(415, "Send the file body as application/octet-stream.");
  }

  const limitMb = getUploadLimitMb();
  const maxBytes = limitMb * 1024 * 1024;
  const declared = Number(req.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError(413, `The file exceeds the ${limitMb} MB upload limit.`);
  }

  const credentials = getSshCredentials();
  if (!credentials) {
    throw new ApiError(
      409,
      "SSH is not configured. Add the host, username and password or private key in Settings.",
    );
  }

  await sshUploadFile(credentials, {
    directory,
    name: fileName,
    source: req,
    maxBytes,
    limitLabel: `${limitMb} MB`,
  });
  res.json({ ok: true, path: `${directory === "/" ? "" : directory}/${fileName}` });
});

appsRouter.patch("/apps/:id", (req, res) => {
  const id = requireParam(req.params, "id");
  const input = parseBody(updateAppSchema, req.body);
  const { row, needsRedeploy } = updateApp(id, input);
  const deployment = needsRedeploy ? enqueueDeployment(id, "manual", automaticRedeployOptions(row)) : null;
  res.json({
    app: toPublicApp(row, getBaseDomain()),
    deployment: deployment ? serializeDeployment(deployment) : null,
  });
});

appsRouter.delete("/apps/:id", async (req, res) => {
  const id = requireParam(req.params, "id");
  const app = requireAppRow(id);
  const removeVolumes = req.query.removeVolumes === "true";
  const warnings: string[] = [];

  if (app.sourceType === "compose") {
    try {
      await removeComposeProjectForApp(app, removeVolumes, () => undefined);
    } catch (error) {
      warnings.push(
        `Could not remove the compose project: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  } else {
    const containers = await listAppContainers(id);
    for (const container of containers) {
      try {
        await removeContainer(container.id);
      } catch (error) {
        warnings.push(
          `Could not remove container ${container.id.slice(0, 12)}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (removeVolumes) {
      for (const volume of app.volumes) {
        try {
          await removeAppVolume(volume.volumeName);
        } catch (error) {
          warnings.push(
            `Could not remove volume ${volume.volumeName}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
  }

  deleteAppRow(id);
  res.json({ ok: true, warnings });
});

appsRouter.post("/apps/:id/deploy", (req, res) => {
  const id = requireParam(req.params, "id");
  const app = requireAppRow(id);
  const deployment = enqueueDeployment(id, "manual", automaticRedeployOptions(app));
  res.status(202).json({ deployment: serializeDeployment(deployment) });
});

appsRouter.post("/apps/:id/restart", async (req, res) => {
  const id = requireParam(req.params, "id");
  const app = requireAppRow(id);
  if (app.sourceType === "compose") {
    await composeLifecycle(app, "restart");
  } else {
    if (!app.containerId) throw new ApiError(409, "This app has not been deployed yet.");
    await restartContainer(app.containerId);
  }
  setAppStatus(id, "running");
  res.json({ ok: true });
});

appsRouter.post("/apps/:id/stop", async (req, res) => {
  const id = requireParam(req.params, "id");
  const app = requireAppRow(id);
  if (app.sourceType === "compose") {
    await composeLifecycle(app, "stop");
  } else {
    if (!app.containerId) throw new ApiError(409, "This app has not been deployed yet.");
    await stopContainer(app.containerId);
  }
  setAppStatus(id, "stopped");
  res.json({ ok: true });
});

appsRouter.post("/apps/:id/start", async (req, res) => {
  const id = requireParam(req.params, "id");
  const app = requireAppRow(id);
  if (app.sourceType === "compose") {
    await composeLifecycle(app, "start");
  } else {
    if (!app.containerId) throw new ApiError(409, "This app has not been deployed yet.");
    await startContainer(app.containerId);
  }
  setAppStatus(id, "running");
  res.json({ ok: true });
});

appsRouter.get("/apps/:id/deployments", (req, res) => {
  const id = requireParam(req.params, "id");
  requireAppRow(id);
  res.json({ deployments: listDeployments(id).map(serializeDeployment) });
});

appsRouter.get("/apps/:id/deployments/:deploymentId", (req, res) => {
  const appId = requireParam(req.params, "id");
  const deploymentId = requireParam(req.params, "deploymentId");
  requireAppRow(appId);
  const deployment = getDeploymentForApp(appId, deploymentId);
  if (!deployment) throw new ApiError(404, "Deployment not found.");
  res.json({ deployment: serializeDeploymentDetail(deployment) });
});
