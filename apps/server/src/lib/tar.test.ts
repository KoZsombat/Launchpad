import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import tar from "tar-fs";
import { describe, expect, it } from "vitest";
import {
  normalizeContainerDir,
  safeUploadName,
  stageUploadFile,
  type StagedUpload,
} from "./tar";

async function archiveToBuffer(upload: StagedUpload): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  upload.archive
    .on("data", (chunk: Buffer) => chunks.push(chunk))
    .on("end", resolve)
    .on("error", reject);
  await promise;
  await upload.cleanup();
  return Buffer.concat(chunks);
}

async function extractToTemp(archive: Buffer): Promise<string> {
  const destination = await mkdtemp(path.join(tmpdir(), "launchpad-test-"));
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  tar
    .extract(destination)
    .on("finish", resolve)
    .on("error", reject)
    .end(archive);
  await promise;
  return destination;
}

describe("safeUploadName", () => {
  it("keeps only the final path component", () => {
    expect(safeUploadName("../../etc/passwd")).toBe("passwd");
    expect(safeUploadName("C:\\Users\\me\\app.tar")).toBe("app.tar");
    expect(safeUploadName("notes.md")).toBe("notes.md");
  });

  it("rejects empty and dot-only names", () => {
    expect(() => safeUploadName("")).toThrow();
    expect(() => safeUploadName("..")).toThrow();
    expect(() => safeUploadName("dir/")).toThrow();
  });
});

describe("normalizeContainerDir", () => {
  it("requires an absolute container path", () => {
    expect(() => normalizeContainerDir("tmp/uploads")).toThrow();
  });

  it("normalizes separators and trailing slashes", () => {
    expect(normalizeContainerDir("/app//uploads/")).toBe("/app/uploads");
    expect(normalizeContainerDir("/")).toBe("/");
  });
});

describe("stageUploadFile", () => {
  it("provisions nested destination directories with the file", async () => {
    const upload = await stageUploadFile(
      Readable.from([Buffer.from("hi")]),
      "/app/data",
      "hello.txt",
      64 * 1024 * 1024,
      "64 MB",
    );
    const archive = await archiveToBuffer(upload);
    const destination = await extractToTemp(archive);
    try {
      expect(await readFile(path.join(destination, "app/data/hello.txt"), "utf8")).toBe("hi");
    } finally {
      await rm(destination, { recursive: true, force: true });
    }
  });

  it("rejects payloads above the byte limit", async () => {
    await expect(
      stageUploadFile(
        Readable.from([Buffer.alloc(2_048), Buffer.alloc(1_024)]),
        "/tmp",
        "big.bin",
        1_024,
        "1 KB",
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
});
