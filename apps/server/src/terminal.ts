import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import { fromNodeHeaders } from "better-auth/node";
import { Client as SshClient, type ClientChannel } from "ssh2";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { auth } from "./auth";
import { config } from "./config";
import { getSshCredentials } from "./services/settings";

const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("data"), data: z.string().max(65_536) }),
  z.object({
    type: z.literal("resize"),
    cols: z.number().int().min(20).max(500),
    rows: z.number().int().min(5).max(300),
  }),
  z.object({ type: z.literal("ping") }),
]);

const MAX_SESSIONS = 5;
const activeSockets = new Set<WebSocket>();

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${message}`,
  );
  socket.destroy();
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

export function attachTerminalServer(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/terminal") {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    void (async () => {
      const allowedOrigins = new Set([config.panelUrl]);
      if (!config.isProduction) {
        allowedOrigins.add("http://localhost:5173");
        allowedOrigins.add("http://127.0.0.1:5173");
      }
      const origin = req.headers.origin;
      if (!origin || !allowedOrigins.has(origin)) {
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }

      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      if (!session?.user) {
        rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }

      if (activeSockets.size >= MAX_SESSIONS) {
        rejectUpgrade(socket, 429, "Too Many Sessions");
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
        handleConnection(ws);
      });
    })().catch((error) => {
      console.error("Terminal upgrade failed:", error);
      rejectUpgrade(socket, 500, "Internal Server Error");
    });
  });
}

function handleConnection(ws: WebSocket): void {
  activeSockets.add(ws);
  const credentials = getSshCredentials();
  if (!credentials) {
    sendJson(ws, {
      type: "error",
      message:
        "SSH is not configured. Add a host, username and password or private key in Settings.",
    });
    ws.close();
    activeSockets.delete(ws);
    return;
  }

  const ssh = new SshClient();
  let channel: ClientChannel | null = null;
  let closed = false;

  const shutdown = (): void => {
    if (closed) return;
    closed = true;
    try {
      channel?.end();
    } catch {
      // Channel may already be gone.
    }
    try {
      ssh.end();
    } catch {
      // Client may already be gone.
    }
    activeSockets.delete(ws);
  };

  ssh.on("ready", () => {
    ssh.shell(
      { term: "xterm-256color", cols: 100, rows: 30 },
      (error, stream) => {
        if (error) {
          sendJson(ws, { type: "error", message: `SSH shell failed: ${error.message}` });
          ws.close();
          return;
        }
        channel = stream;
        sendJson(ws, { type: "ready" });
        stream.on("data", (data: Buffer) => {
          sendJson(ws, { type: "data", data: data.toString("utf8") });
        });
        stream.stderr.on("data", (data: Buffer) => {
          sendJson(ws, { type: "data", data: data.toString("utf8") });
        });
        stream.on("close", () => {
          sendJson(ws, { type: "exit" });
          ws.close();
          shutdown();
        });
      },
    );
  });

  ssh.on("error", (error: Error) => {
    sendJson(ws, { type: "error", message: `SSH error: ${error.message}` });
    ws.close();
    shutdown();
  });

  ssh.on("close", () => {
    sendJson(ws, { type: "exit" });
    if (ws.readyState === WebSocket.OPEN) ws.close();
    shutdown();
  });

  ws.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const result = clientMessageSchema.safeParse(parsed);
    if (!result.success) return;
    const message = result.data;
    if (message.type === "resize") {
      channel?.setWindow(message.rows, message.cols, 0, 0);
    } else if (message.type === "data") {
      channel?.write(message.data);
    }
  });

  ws.on("close", shutdown);
  ws.on("error", shutdown);

  ssh.connect({
    host: credentials.host,
    port: credentials.port,
    username: credentials.username,
    ...(credentials.authMethod === "password"
      ? { password: credentials.password ?? undefined }
      : { privateKey: credentials.privateKey ?? undefined }),
    readyTimeout: 15_000,
  });
}
