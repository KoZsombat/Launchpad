import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import { fromNodeHeaders } from "better-auth/node";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { auth } from "./auth";
import { config } from "./config";
import { getSshCredentials } from "./services/settings";
import { requireAppRow } from "./services/apps";
import { appWorkspacePath } from "./services/workspace";
import { shellQuote, sshShell, type SshShell } from "./lib/ssh";

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
const APP_TERMINAL_PATH = /^\/api\/terminal\/apps\/([^/]+)$/;
const INITIAL_SIZE = { cols: 100, rows: 30 };

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${message}`,
  );
  socket.destroy();
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shellHandlers(ws: WebSocket): {
  onData: (chunk: Buffer) => void;
  onExit: () => void;
} {
  return {
    onData: (chunk) => sendJson(ws, { type: "data", data: chunk.toString("utf8") }),
    onExit: () => {
      sendJson(ws, { type: "exit" });
      if (ws.readyState === WebSocket.OPEN) ws.close();
    },
  };
}

export interface ShellScope {
  label: string;
  workspace: string | null;
}

/** Opens the host shell; app terminals start in that app's workspace. */
async function openHostShell(ws: WebSocket, scope: ShellScope | null): Promise<SshShell> {
  const credentials = getSshCredentials();
  if (!credentials) {
    throw new Error(
      "SSH is not configured. Add a host, username and password or private key in Settings.",
    );
  }
  const handlers = shellHandlers(ws);
  const script: string[] = [];
  if (scope) {
    const heading = scope.workspace
      ? `Launchpad · ${scope.label} · ${scope.workspace}`
      : `Launchpad · ${scope.label}`;
    script.push(`printf '%s\\n' ${shellQuote(heading)}`);
  }
  if (scope?.workspace) {
    script.push(`mkdir -p -- ${shellQuote(scope.workspace)} 2>/dev/null || true`);
    script.push(`cd -- ${shellQuote(scope.workspace)} 2>/dev/null || cd ~`);
  }
  script.push('exec "${SHELL:-/bin/sh}" -l');

  return sshShell(credentials, {
    cols: INITIAL_SIZE.cols,
    rows: INITIAL_SIZE.rows,
    command: script.join("; "),
    onData: handlers.onData,
    onClose: handlers.onExit,
  });
}

function handleHostConnection(ws: WebSocket): void {
  bridgeShell(ws, () => openHostShell(ws, null));
}

function handleAppConnection(ws: WebSocket, appId: string): void {
  bridgeShell(ws, async () => {
    const app = requireAppRow(appId);
    const workspace = await appWorkspacePath(app);
    return openHostShell(ws, { label: app.name, workspace });
  });
}

/** Bridges one websocket to a shell; the opener resolves once the shell is attached. */
function bridgeShell(ws: WebSocket, open: () => Promise<SshShell>): void {
  activeSockets.add(ws);
  let shell: SshShell | null = null;
  let closed = false;

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    shell?.close();
    activeSockets.delete(ws);
  };

  ws.on("close", cleanup);
  ws.on("error", cleanup);

  void open().then(
    (opened) => {
      if (closed) {
        opened.close();
        return;
      }
      shell = opened;
      sendJson(ws, { type: "ready" });
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
        if (message.type === "resize") opened.resize(message.cols, message.rows);
        else if (message.type === "data") opened.write(message.data);
      });
    },
    (error: unknown) => {
      sendJson(ws, { type: "error", message: errorMessage(error) });
      cleanup();
      if (ws.readyState === WebSocket.OPEN) ws.close();
    },
  );
}

export function attachTerminalServer(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const appMatch = APP_TERMINAL_PATH.exec(url.pathname);
    if (url.pathname !== "/api/terminal" && !appMatch) {
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
        const appId = appMatch?.[1];
        if (appId) {
          handleAppConnection(ws, decodeURIComponent(appId));
        } else {
          handleHostConnection(ws);
        }
      });
    })().catch((error) => {
      console.error("Terminal upgrade failed:", error);
      rejectUpgrade(socket, 500, "Internal Server Error");
    });
  });
}
