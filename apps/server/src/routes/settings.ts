import { Router } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { changePasswordSchema, settingsSchema } from "@launchpad/shared";
import { auth } from "../auth";
import { parseBody } from "../lib/http";
import {
  getSettingsView,
  updateSettings,
} from "../services/settings";

export const settingsRouter = Router();

settingsRouter.get("/settings", (_req, res) => {
  res.json({ settings: getSettingsView() });
});

settingsRouter.put("/settings", (req, res) => {
  const input = parseBody(settingsSchema, req.body);
  res.json({ settings: updateSettings(input) });
});

settingsRouter.post("/settings/password", async (req, res) => {
  const input = parseBody(changePasswordSchema, req.body);
  await auth.api.changePassword({
    body: {
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      revokeOtherSessions: true,
    },
    headers: fromNodeHeaders(req.headers),
  });
  res.json({ ok: true });
});
