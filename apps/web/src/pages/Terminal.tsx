import { useRef, useState } from "react";
import { PlugZap, Trash2 } from "lucide-react";
import { Button, cn } from "../components/ui";
import { TerminalKeyBar } from "../components/TerminalKeyBar";
import {
  XtermSession,
  type TerminalStatus,
  type XtermSessionHandle,
} from "../components/XtermSession";

export function TerminalPage() {
  const terminalRef = useRef<XtermSessionHandle>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [status, setStatus] = useState<TerminalStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [ctrlArmed, setCtrlArmed] = useState(false);

  const statusLabel =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting…"
        : status === "error"
          ? "Connection error"
          : "Disconnected";

  const send = (data: string) => {
    terminalRef.current?.send(data);
    terminalRef.current?.focus();
  };

  return (
    <div className="mx-auto flex h-full min-h-[360px] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-edge bg-panel">
      <header className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              status === "connected"
                ? "bg-success"
                : status === "connecting"
                  ? "animate-pulse bg-warning"
                  : status === "error"
                    ? "bg-danger"
                    : "bg-muted",
            )}
          />
          <span className="truncate text-sm font-medium">SSH terminal</span>
          <span className="truncate text-xs text-muted">· {statusLabel}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => terminalRef.current?.clear()}>
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
          <Button size="sm" onClick={() => setSessionKey((value) => value + 1)}>
            <PlugZap className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Reconnect</span>
            <span className="sm:hidden">New</span>
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

      <XtermSession
        key={sessionKey}
        ref={terminalRef}
        url="/api/terminal"
        onStatus={setStatus}
        onError={setError}
        ctrlArmed={ctrlArmed}
        onCtrlConsumed={() => setCtrlArmed(false)}
      />
      <TerminalKeyBar
        onSend={send}
        ctrlArmed={ctrlArmed}
        onToggleCtrl={() => setCtrlArmed((value) => !value)}
      />
      <footer className="hidden border-t border-edge px-4 py-1.5 text-[11px] text-muted lg:block">
        SSH session runs from the panel container. Ctrl + ` switches back to the GUI.
      </footer>
    </div>
  );
}
