import express, { Router } from "express";
import { z } from "zod";
import { deployHookSchema } from "@launchpad/shared";
import { getAppRow, getWebhookSecret } from "../services/apps";
import { enqueueDeployment } from "../deploy/runner";
import { secretEquals } from "../crypto";
import { parseJsonBuffer, verifyGithubSignature } from "../lib/webhook";
import { serializeDeployment } from "../services/deployments";
import { ApiError } from "../lib/errors";

export const hooksRouter = Router();

const rawBody = express.raw({ type: "*/*", limit: "1mb" });

const githubPushSchema = z.object({
  ref: z.string().optional(),
  after: z.string().optional(),
  deleted: z.boolean().optional(),
});

hooksRouter.post("/deploy/:appId", rawBody, (req, res) => {
  const appId = req.params.appId;
  if (!appId) throw new ApiError(400, "Missing app id.");
  const app = getAppRow(appId);
  if (!app) throw new ApiError(404, "App not found.");
  if (!app.cicdEnabled) throw new ApiError(403, "CI/CD is not enabled for this app.");

  const provided = req.get("x-launchpad-secret");
  if (!secretEquals(provided, getWebhookSecret(app))) {
    throw new ApiError(401, "Invalid webhook secret.");
  }

  const payload = parseJsonBuffer(req.body);
  if (!payload || typeof payload !== "object") {
    throw new ApiError(400, "Body must be a JSON object.");
  }
  const result = deployHookSchema.safeParse(payload);
  if (!result.success) {
    throw new ApiError(422, "Validation failed.", result.error.issues);
  }

  const deployment = enqueueDeployment(app.id, "webhook", {
    imageTag: result.data.imageTag,
    commitSha: result.data.commitSha ?? null,
  });
  res.status(202).json({ deployment: serializeDeployment(deployment) });
});

hooksRouter.post("/github/:appId", rawBody, (req, res) => {
  const appId = req.params.appId;
  if (!appId) throw new ApiError(400, "Missing app id.");
  const app = getAppRow(appId);
  if (!app) throw new ApiError(404, "App not found.");
  if (app.sourceType !== "github") {
    throw new ApiError(400, "This app does not use a GitHub source.");
  }
  if (app.cicdEnabled) {
    throw new ApiError(409, "This app deploys through its GitHub Actions workflow.");
  }

  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!verifyGithubSignature(body, req.get("x-hub-signature-256"), getWebhookSecret(app))) {
    throw new ApiError(401, "Invalid GitHub signature.");
  }

  const event = req.get("x-github-event");
  if (event === "ping") {
    res.json({ ok: true });
    return;
  }
  if (event !== "push") {
    res.status(202).json({ ignored: true, reason: "Only push events are handled." });
    return;
  }

  const payload = githubPushSchema.safeParse(parseJsonBuffer(req.body));
  if (!payload.success) {
    throw new ApiError(400, "Invalid push payload.");
  }
  if (payload.data.deleted || payload.data.after === "0000000000000000000000000000000000000000") {
    res.status(202).json({ ignored: true, reason: "Branch deletion ignored." });
    return;
  }
  if (payload.data.ref !== `refs/heads/${app.branch}`) {
    res.status(202).json({ ignored: true, reason: "Push is not for the configured branch." });
    return;
  }

  const deployment = enqueueDeployment(app.id, "github-push");
  res.status(202).json({ deployment: serializeDeployment(deployment) });
});
