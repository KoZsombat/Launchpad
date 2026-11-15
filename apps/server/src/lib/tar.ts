import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import tar from "tar-fs";
import { ApiError } from "./errors";

/** Rejects traversal and keeps only the final path component of a client file name. */
export function safeUploadName(raw: string): string {
  const base = raw.split(/[\\/]/).pop()?.trim() ?? "";
  if (!base || base === "." || base === "..") {
    throw new ApiError(400, "A valid file name is required.");
  }
  return base;
}

/** Normalizes a container path; uploads must target an absolute directory. */
export function normalizeContainerDir(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) {
    throw new ApiError(400, "The destination must be an absolute path inside the container.");
  }
  const normalized = path.posix.normalize(trimmed);
  if (!normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new ApiError(400, "The destination path is not valid.");
  }
  return normalized === "/" ? "/" : normalized.replace(/\/+$/, "");
}

export interface StagedUpload {
  /**
   * Tar stream rooted at `/` whose entries mirror `<destinationDir>/<name>`, so
   * extracting it at the container root creates directories without needing
   * mkdir/tar binaries inside the image (putArchive / `docker cp -`).
   */
  archive: Readable;
  cleanup: () => Promise<void>;
}

/**
 * Streams the request body into a temp directory laid out like the container
 * path, enforcing `maxBytes`, then returns a tar stream of that directory.
 */
export async function stageUploadFile(
  source: Readable,
  destinationDir: string,
  name: string,
  maxBytes: number,
  limitLabel: string,
): Promise<StagedUpload> {
  const segments = destinationDir.split("/").filter(Boolean);
  const root = await mkdtemp(path.join(tmpdir(), "launchpad-upload-"));
  const cleanup = () => rm(root, { recursive: true, force: true });
  try {
    const directory = path.join(root, ...segments);
    await mkdir(directory, { recursive: true });

    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > maxBytes) {
          callback(new ApiError(413, `The file exceeds the ${limitLabel} upload limit.`));
          return;
        }
        callback(null, chunk);
      },
    });
    await pipeline(source, limiter, createWriteStream(path.join(directory, name)));

    const archive = tar.pack(root, {
      // tar entries always use forward slashes, even on Windows.
      map: (header) => ({ ...header, name: header.name.split(path.sep).join("/") }),
    });
    return { archive, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
