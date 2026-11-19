import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ForwardedRef,
} from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { cn } from "./ui";

export type TerminalStatus = "connecting" | "connected" | "disconnected" | "error";

export interface XtermSessionHandle {
  clear: () => void;
  focus: () => void;
  /** Sends raw bytes to the shell (used by the mobile key bar). */
  send: (data: string) => void;
}

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

interface XtermSessionProps {
  /** WebSocket path, e.g. `/api/terminal` or `/api/terminal/apps/<id>?container=<id>`. */
  url: string;
  className?: string;
  onStatus?: (status: TerminalStatus) => void;
  onError?: (message: string | null) => void;
  /** Sends the next single typed character as Ctrl+<char>. */
  ctrlArmed?: boolean;
  onCtrlConsumed?: () => void;
}

/** Maps a printable key to its Ctrl+key control byte. */
function toControlCode(char: string): string | null {
  if (!/^[A-Za-z@\[\]\\^_]$/.test(char)) return null;
  return String.fromCharCode(char.toUpperCase().charCodeAt(0) & 31);
}

/** xterm.js view backed by a websocket that carries raw terminal bytes. */
export const XtermSession = forwardRef<XtermSessionHandle, XtermSessionProps>(
  function XtermSession(
    { url, className, onStatus, onError, ctrlArmed = false, onCtrlConsumed }: XtermSessionProps,
    ref: ForwardedRef<XtermSessionHandle>,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const socketRef = useRef<WebSocket | null>(null);
    const ctrlRef = useRef(ctrlArmed);
    ctrlRef.current = ctrlArmed;
    const callbacks = useRef({ onStatus, onError, onCtrlConsumed });
    callbacks.current = { onStatus, onError, onCtrlConsumed };

    useImperativeHandle(
      ref,
      () => ({
        clear: () => terminalRef.current?.clear(),
        focus: () => terminalRef.current?.focus(),
        send: (data: string) => {
          const socket = socketRef.current;
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "data", data }));
          }
        },
      }),
      [],
    );

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const report = callbacks.current;
      report.onStatus?.("connecting");
      report.onError?.(null);

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
      let hadError = false;
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${protocol}://${window.location.host}${url}`);
      socketRef.current = socket;

      const sendResize = () => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }),
          );
        }
      };

      socket.addEventListener("open", () => {
        report.onStatus?.("connected");
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
        const typed = message as { type: string; data?: string; message?: string };
        if (typed.type === "data" && typeof typed.data === "string") {
          terminal.write(typed.data);
        } else if (typed.type === "ready") {
          report.onStatus?.("connected");
          // The server opens the shell at its default size; apply ours once it exists.
          sendResize();
        } else if (typed.type === "error") {
          hadError = true;
          report.onStatus?.("error");
          report.onError?.(typed.message ?? "Connection failed.");
        } else if (typed.type === "exit") {
          terminal.writeln("\r\n\x1b[33m[session ended]\x1b[0m");
          report.onStatus?.("disconnected");
        }
      });

      socket.addEventListener("close", () => {
        if (disposed) return;
        report.onStatus?.(hadError ? "error" : "disconnected");
      });

      socket.addEventListener("error", () => {
        hadError = true;
        report.onStatus?.("error");
        report.onError?.("WebSocket connection failed.");
      });

      const raf = requestAnimationFrame(() => fit.fit());

      const dataSubscription = terminal.onData((data) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        let payload = data;
        if (ctrlRef.current && data.length === 1) {
          const code = toControlCode(data);
          if (code) payload = code;
          callbacks.current.onCtrlConsumed?.();
        }
        socket.send(JSON.stringify({ type: "data", data: payload }));
      });

      const observer = new ResizeObserver(() => {
        if (disposed) return;
        fit.fit();
        sendResize();
      });
      observer.observe(container);

      const viewport = window.visualViewport;
      const onViewportResize = () => {
        if (disposed) return;
        fit.fit();
        sendResize();
      };
      viewport?.addEventListener("resize", onViewportResize);

      return () => {
        disposed = true;
        cancelAnimationFrame(raf);
        dataSubscription.dispose();
        observer.disconnect();
        viewport?.removeEventListener("resize", onViewportResize);
        socketRef.current = null;
        socket.close();
        terminal.dispose();
        terminalRef.current = null;
      };
    }, [url]);

    return (
      <div
        ref={containerRef}
        className={cn("min-h-0 flex-1 bg-[#0b0e14] px-2 py-2", className)}
        onClick={() => terminalRef.current?.focus()}
      />
    );
  },
);
