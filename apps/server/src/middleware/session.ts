import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

declare global {
  namespace Express {
    interface Locals {
      user: SessionUser;
    }
  }
}

export async function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.locals.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    };
    next();
  } catch (error) {
    next(error);
  }
}

/** Session check for endpoints that cannot use middleware (SSE). */
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session?.user) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
}
