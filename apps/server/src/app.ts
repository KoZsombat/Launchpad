import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import fs from "node:fs";
import path from "node:path";
import { toNodeHandler } from "better-auth/node";
import { ZodError } from "zod";
import { auth } from "./auth";
import { config } from "./config";
import { ApiError } from "./lib/errors";
import { requireSession } from "./middleware/session";
import { appsRouter } from "./routes/apps";
import { cicdRouter } from "./routes/cicd";
import { hooksRouter } from "./routes/hooks";
import { logsRouter } from "./routes/logs";
import { settingsRouter } from "./routes/settings";

export function createApp(): express.Express {
  const app = express();
  app.set("trust proxy", config.trustProxy);
  app.disable("x-powered-by");

  app.use(
    helmet({
      // HSTS and HTTPS upgrades only make sense behind the production HTTPS tunnel.
      strictTransportSecurity: config.isProduction
        ? { maxAge: 15_552_000, includeSubDomains: true }
        : false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
          ...(config.isProduction ? {} : { upgradeInsecureRequests: null }),
        },
      },
    }),
  );

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1_000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many login attempts. Try again in a few minutes." },
    validate: { trustProxy: false },
  });
  app.use("/api/auth/sign-in/email", loginLimiter);

  // Better Auth must see the raw request body, so it is mounted before express.json().
  app.all("/api/auth/*splat", toNodeHandler(auth));

  // Webhooks verify raw bodies themselves and are deliberately public.
  app.use("/api/hooks", hooksRouter);

  app.use(express.json({ limit: "1mb" }));

  // Outside /api so every /api route except auth/hooks is session-protected.
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api", requireSession);
  app.use("/api", appsRouter);
  app.use("/api", cicdRouter);
  app.use("/api", logsRouter);
  app.use("/api", settingsRouter);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found." });
  });

  const indexFile = path.join(config.webDist, "index.html");
  app.use(express.static(config.webDist, { index: false, maxAge: "1h" }));
  app.use((req, res, next) => {
    if (req.method !== "GET") {
      next();
      return;
    }
    if (!fs.existsSync(indexFile)) {
      res.status(503).send("The web build was not found. Run `pnpm build` first.");
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexFile);
  });

  app.use(errorHandler);
  return app;
}

function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ApiError) {
    res.status(error.status).json({
      error: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
    return;
  }
  if (error instanceof ZodError) {
    res.status(422).json({ error: "Validation failed.", details: error.issues });
    return;
  }
  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({ error: "Invalid JSON body." });
    return;
  }
  console.error("Unhandled request error:", error);
  res.status(500).json({ error: "Internal server error." });
}
