import { useEffect, useRef, useState } from "react";
import type { DeploymentStatus } from "@launchpad/shared";
import { isTerminalStatus } from "@launchpad/shared";
import { cn } from "./ui";
import { DeploymentBadge } from "./ui";

function readField(data: string, field: string): string | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (parsed && typeof parsed === "object" && field in parsed) {
      const record = parsed as Record<string, unknown>;
      const value = record[field];
      return typeof value === "string" ? value : null;
    }
  } catch {
    return null;
  }
  return null;
}

function readStatus(data: string): DeploymentStatus | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (parsed && typeof parsed === "object" && "status" in parsed) {
      const value = parsed.status;
      if (typeof value === "string") return value as DeploymentStatus;
    }
  } catch {
    return null;
  }
  return null;
}

export function DeploymentLogViewer({
  appId,
  deploymentId,
}: {
  appId: string;
  deploymentId: string;
}) {
  const [log, setLog] = useState("");
  const [status, setStatus] = useState<DeploymentStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    setLog("");
    setStatus(null);
    setConnected(false);
    stickRef.current = true;

    const source = new EventSource(`/api/apps/${appId}/deployments/${deploymentId}/logs`);

    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("snapshot", (event) => {
      const snapshotLog = readField(event.data, "log");
      if (snapshotLog !== null) setLog(snapshotLog);
    });
    source.addEventListener("log", (event) => {
      const line = readField(event.data, "line");
      if (line !== null) setLog((current) => current + line);
    });
    source.addEventListener("status", (event) => {
      const nextStatus = readStatus(event.data);
      if (!nextStatus) return;
      setStatus(nextStatus);
      if (isTerminalStatus(nextStatus)) {
        source.close();
        setConnected(false);
      }
    });
    source.addEventListener("error", () => {
      if (source.readyState === EventSource.CLOSED) setConnected(false);
    });

    return () => source.close();
  }, [appId, deploymentId]);

  useEffect(() => {
    const pre = preRef.current;
    if (pre && stickRef.current) pre.scrollTop = pre.scrollHeight;
  }, [log]);

  return (
    <div className="overflow-hidden rounded-lg border border-edge bg-[#080b11]">
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
        {status ? <DeploymentBadge status={status} /> : null}
        <span className="text-[11px] text-zinc-500">
          {connected ? "streaming" : "not streaming"}
        </span>
      </div>
      <pre
        ref={preRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          stickRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 32;
        }}
        className={cn(
          "line-clamp-log h-72 overflow-auto p-3 font-mono text-[11.5px] leading-relaxed text-zinc-300 sm:h-96",
        )}
      >
        {log || "Waiting for log output…"}
      </pre>
    </div>
  );
}

export function ContainerLogsPanel({
  appId,
  hasContainer,
}: {
  appId: string;
  hasContainer: boolean;
}) {
  const [active, setActive] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const preRef = useRef<HTMLPreElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    if (!active) return;
    setLines([]);
    const source = new EventSource(`/api/apps/${appId}/logs`);
    source.addEventListener("log", (event) => {
      const line = readField(event.data, "line");
      if (line === null) return;
      setLines((current) => {
        const next = [...current, line];
        return next.length > 2_000 ? next.slice(next.length - 2_000) : next;
      });
    });
    source.addEventListener("error", () => {
      if (source.readyState === EventSource.CLOSED) setActive(false);
    });
    return () => source.close();
  }, [active, appId]);

  useEffect(() => {
    const pre = preRef.current;
    if (pre && stickRef.current) pre.scrollTop = pre.scrollHeight;
  }, [lines]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setActive((value) => !value)}
          disabled={!hasContainer}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-edge bg-panel-2 px-3 text-xs text-ink transition hover:border-accent/40 hover:text-accent disabled:opacity-50"
        >
          {active ? "Disconnect" : "Follow live logs"}
        </button>
        <span className="text-xs text-muted">
          {hasContainer
            ? "Follows stdout/stderr of the running container."
            : "Deploy the app to see container logs."}
        </span>
      </div>
      {/* Kept mounted so scroll position survives toggling the stream. */}
      <pre
        ref={preRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          stickRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 32;
        }}
        className="line-clamp-log h-64 overflow-auto rounded-lg border border-edge bg-[#080b11] p-3 font-mono text-[11.5px] leading-relaxed text-zinc-300"
      >
        {active ? lines.join("\n") || "Waiting for output…" : "Stream is paused."}
      </pre>
    </div>
  );
}
