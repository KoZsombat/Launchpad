import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { PlugZap, Trash2 } from "lucide-react";
import { Button, cn } from "../components/ui";

type TerminalStatus = "connecting" | "connected" | "disconnected" | "error";

const terminalTheme = {
  background: "#0b0e14",
  foreground: "#d7e0ec",
  cursor: "#818cf8",
  selectionBackground: "#334155",
  black: "#0b0e14",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#e2e8f0",
  brightBlack: "#64748b",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#f8fafc",
};

export function TerminalPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [status, setStatus] = useState<TerminalStatus>("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setStatus("connecting");
    setError(null);

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.25,
      fontFamily:
        '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: terminalTheme,
      scrollback: 5_000,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    terminalRef.current = terminal;

    let disposed = false;
    let socket: WebSocket | null = null;
    let hadError = false;

    const sendResize = () => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }),
        );
      }
    };

    const connect = () => {
      hadError = false;
      setStatus("connecting");
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${window.location.host}/api/terminal`);

      socket.addEventListener("open", () => {
        setStatus("connected");
        sendResize();
        terminal.focus();
      });

      socket.addEventListener("message", (event) => {
        let message: unknown;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!message || typeof message !== "object" || !("type" in message)) return;
        const typed = message as {
          type: string;
          data?: string;
          message?: string;
        };
        if (typed.type === "data" && typeof typed.data === "string") {
          terminal.write(typed.data);
        } else if (typed.type === "ready") {
          setStatus("connected");
        } else if (typed.type === "error") {
          hadError = true;
          setStatus("error");
          setError(typed.message ?? "SSH connection failed.");
        } else if (typed.type === "exit") {
          terminal.writeln("\r\n\x1b[33m[session ended]\x1b[0m");
          setStatus("disconnected");
        }
      });

      socket.addEventListener("close", () => {
        if (disposed) return;
        setStatus((current) => (current === "error" || hadError ? "error" : "disconnected"));
      });

      socket.addEventListener("error", () => {
        hadError = true;
        setStatus("error");
        setError("WebSocket connection failed.");
      });
    };

    const raf = requestAnimationFrame(() => {
      fit.fit();
      connect();
    });

    const dataSubscription = terminal.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "data", data }));
      }
    });

    const observer = new ResizeObserver(() => {
      if (disposed) return;
      fit.fit();
      sendResize();
    });
    observer.observe(container);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      dataSubscription.dispose();
      observer.disconnect();
      socket?.close();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [sessionKey]);

  const statusLabel =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting…"
        : status === "error"
          ? "Connection error"
          : "Disconnected";

  return (
    <div className="mx-auto flex h-[calc(100dvh-13rem)] min-h-[420px] max-w-6xl flex-col overflow-hidden rounded-xl border border-edge bg-panel lg:h-[calc(100dvh-8.5rem)]">
      <header className="flex flex-wrap items-center gap-3 border-b border-edge px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              status === "connected"
                ? "bg-success"
                : status === "connecting"
                  ? "animate-pulse bg-warning"
                  : status === "error"
                    ? "bg-danger"
                    : "bg-muted",
            )}
          />
          <span className="text-sm font-medium">SSH terminal</span>
          <span className="text-xs text-muted">· {statusLabel}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => terminalRef.current?.clear()}>
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </Button>
          <Button size="sm" onClick={() => setSessionKey((value) => value + 1)}>
            <PlugZap className="h-3.5 w-3.5" />
            Reconnect
          </Button>
        </div>
      </header>

      {error ? (
        <div className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger">
          {error}
          {error.includes("not configured") ? (
            <span className="text-danger/80"> Configure SSH under Settings.</span>
          ) : null}
        </div>
      ) : null}

      <div
        ref={containerRef}
        className="min-h-0 flex-1 bg-[#0b0e14] px-2 py-2"
        onClick={() => terminalRef.current?.focus()}
      />
      <footer className="border-t border-edge px-4 py-1.5 text-[11px] text-muted">
        SSH session runs from the panel container. Ctrl + ` switches back to the GUI.
      </footer>
    </div>
  );
}
