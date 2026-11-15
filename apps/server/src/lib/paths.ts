import path from "node:path";
import { ApiError } from "./errors";

/** Rejects traversal and keeps only the final path component of a client file name. */
export function safeUploadName(raw: string): string {
  const base = raw.split(/[\\/]/).pop()?.trim() ?? "";
  if (!base || base === "." || base === "..") {
    throw new ApiError(400, "A valid file name is required.");
  }
  return base;
}

/** Normalizes an absolute destination path on the host that runs the app. */
export function normalizeHostDir(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) {
    throw new ApiError(400, "The destination must be an absolute path on the host.");
  }
  const normalized = path.posix.normalize(trimmed);
  if (!normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new ApiError(400, "The destination path is not valid.");
  }
  return normalized === "/" ? "/" : normalized.replace(/\/+$/, "");
}
