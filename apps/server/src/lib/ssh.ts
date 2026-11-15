import { Client, type ClientChannel } from "ssh2";
import type { Readable } from "node:stream";
import type { SshCredentials } from "../services/settings";

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function connect(credentials: SshCredentials): Promise<Client> {
  const { promise, resolve, reject } = Promise.withResolvers<Client>();
  const client = new Client();
  client
    .on("ready", () => resolve(client))
    .on("error", (error) => reject(error))
    .connect({
      host: credentials.host,
      port: credentials.port,
      username: credentials.username,
      ...(credentials.authMethod === "password"
        ? { password: credentials.password ?? undefined }
        : { privateKey: credentials.privateKey ?? undefined }),
      readyTimeout: 20_000,
    });
  return promise;
}

function lineLogger(log?: (line: string) => void): {
  push: (chunk: Buffer | string) => void;
  flush: () => void;
} {
  let buffer = "";
  return {
    push(chunk) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.replace(/\r/g, "").trimEnd();
        if (trimmed) log?.(trimmed);
      }
    },
    flush() {
      const trimmed = buffer.replace(/\r/g, "").trimEnd();
      if (trimmed) log?.(trimmed);
      buffer = "";
    },
  };
}

export interface SshRunOptions {
  input?: string | Buffer | Readable;
  log?: (line: string) => void;
  timeoutMs?: number;
}

export interface SshRunResult {
  stdout: string;
  stderr: string;
}

/** Runs one shell command over SSH, optionally streaming stdin and output. */
export async function sshRun(
  credentials: SshCredentials,
  command: string,
  options: SshRunOptions = {},
): Promise<SshRunResult> {
  const client = await connect(credentials);
  let channel: ClientChannel | null = null;
  let timer: NodeJS.Timeout | null = null;
  try {
    const execResult = Promise.withResolvers<ClientChannel>();
    client.exec(command, (error, stream) => (error ? execResult.reject(error) : execResult.resolve(stream)));
    channel = await execResult.promise;
    const stream = channel;
    const outLogger = lineLogger(options.log);
    const errLogger = lineLogger(options.log);
    let stdout = "";
    let stderr = "";

    const completion = Promise.withResolvers<void>();
    stream.on("data", (data: Buffer) => {
      stdout += data.toString();
      outLogger.push(data);
    });
    stream.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
      errLogger.push(data);
    });
    stream.on("close", (code: number | undefined) => {
      outLogger.flush();
      errLogger.flush();
      if (code === 0 || code === undefined) completion.resolve();
      else {
        const detail = stderr.trim().split("\n").slice(-4).join("\n");
        completion.reject(
          new Error(`Remote command failed (exit ${code})${detail ? `: ${detail}` : "."}`),
        );
      }
    });
    stream.on("error", (error: Error) => completion.reject(error));

    const input = options.input;
    if (input === undefined) {
      stream.end();
    } else if (typeof input === "string" || Buffer.isBuffer(input)) {
      stream.end(input);
    } else {
      input.on("error", (error: Error) => completion.reject(error));
      input.pipe(stream);
    }

    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          stream.signal("TERM");
          stream.close();
        } catch {
          // Stream may already be gone.
        }
        completion.reject(new Error("Remote command timed out."));
      }, options.timeoutMs);
      timer.unref?.();
    }

    await completion.promise;
    return { stdout, stderr };
  } finally {
    clearTimeout(timer ?? undefined);
    try {
      channel?.close();
    } catch {
      // Channel may already be closed.
    }
    client.end();
  }
}

export interface SshStreamHandlers {
  onLine: (line: string) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}

/** Keeps a remote command running and streams its stdout/stderr line by line. */
export async function sshStream(
  credentials: SshCredentials,
  command: string,
  handlers: SshStreamHandlers,
): Promise<() => void> {
  const client = await connect(credentials);
  const execResult = Promise.withResolvers<ClientChannel>();
  client.exec(command, (error, stream) => (error ? execResult.reject(error) : execResult.resolve(stream)));
  const channel = await execResult.promise;
  const logger = lineLogger(handlers.onLine);
  channel.on("data", (data: Buffer) => logger.push(data));
  channel.stderr.on("data", (data: Buffer) => logger.push(data));
  channel.on("close", () => {
    logger.flush();
    client.end();
    handlers.onClose?.();
  });
  channel.on("error", (error: Error) => {
    handlers.onError?.(error);
    client.end();
  });
  return () => {
    try {
      channel.close();
    } catch {
      // Channel may already be closed.
    }
    client.end();
  };
}

export interface SshShell {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
}

export interface SshShellOptions {
  cols: number;
  rows: number;
  term?: string;
  /** Runs this command under a PTY instead of the account's login shell. */
  command?: string;
  onData: (chunk: Buffer) => void;
  onClose: () => void;
}

/** Opens an interactive shell (or a single PTY command) over SSH. */
export async function sshShell(
  credentials: SshCredentials,
  options: SshShellOptions,
): Promise<SshShell> {
  const client = await connect(credentials);
  const pty = {
    term: options.term ?? "xterm-256color",
    cols: options.cols,
    rows: options.rows,
    width: options.cols * 8,
    height: options.rows * 16,
  };
  const opened = Promise.withResolvers<ClientChannel>();
  const onChannel = (error: Error | undefined, channel: ClientChannel): void => {
    if (error) {
      client.end();
      opened.reject(error);
    } else {
      opened.resolve(channel);
    }
  };
  try {
    if (options.command) client.exec(options.command, { pty }, onChannel);
    else client.shell(pty, onChannel);
    const channel = await opened.promise;

    let closed = false;
    const finish = (): void => {
      if (closed) return;
      closed = true;
      client.end();
      options.onClose();
    };

    channel.on("data", options.onData);
    channel.stderr.on("data", options.onData);
    channel.on("close", finish);
    channel.on("error", finish);

    return {
      write(data) {
        if (!closed) channel.write(data);
      },
      resize(cols, rows) {
        if (!closed) channel.setWindow(rows, cols, 0, 0);
      },
      close() {
        try {
          channel.close();
        } catch {
          // Channel may already be closed.
        }
        finish();
      },
    };
  } catch (error) {
    client.end();
    throw error;
  }
}
