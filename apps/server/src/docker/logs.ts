import type { Readable } from "node:stream";
import { PassThrough } from "node:stream";
import { docker } from "./client";

function lineSplitter(onLine: (line: string) => void): (chunk: Buffer | string) => void {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.toString();
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      const line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      if (line.length > 0) onLine(line);
      index = buffer.indexOf("\n");
    }
    if (buffer.length > 256 * 1024) buffer = buffer.slice(-64 * 1024);
  };
}

/**
 * Follows a container's logs. Returns a cleanup function that stops the
 * stream when the SSE client disconnects.
 */
export async function followContainerLogs(
  containerId: string,
  onLine: (line: string) => void,
): Promise<() => void> {
  const container = docker.getContainer(containerId);
  const info = await container.inspect();
  const rawStream = (await container.logs({
    follow: true,
    stdout: true,
    stderr: true,
    tail: 200,
    timestamps: false,
  })) as unknown as Readable;
  const write = lineSplitter(onLine);

  let cleanup = (): void => {
    rawStream.destroy();
  };

  if (info.Config?.Tty) {
    rawStream.on("data", write);
  } else {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    stdout.on("data", write);
    stderr.on("data", write);
    docker.modem.demuxStream(rawStream, stdout, stderr);
    cleanup = () => {
      rawStream.destroy();
      stdout.destroy();
      stderr.destroy();
    };
  }

  rawStream.on("end", () => onLine("[container log stream ended]"));
  rawStream.on("error", (error: Error) => onLine(`[container log error] ${error.message}`));

  return cleanup;
}
