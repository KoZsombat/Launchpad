import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, PlugZap, Trash2, Upload } from "lucide-react";
import type { AppContainer, PublicApp } from "@launchpad/shared";
import { api, errorMessage } from "../lib/api";
import { Button, Spinner, cn, inputClass } from "../components/ui";
import {
  XtermSession,
  type TerminalStatus,
  type XtermSessionHandle,
} from "../components/XtermSession";

function containerLabel(container: AppContainer): string {
  const name = container.service ? `${container.service} · ${container.name}` : container.name;
  return container.state === "running" ? name : `${name} (${container.state})`;
}

export function AppTerminalPage() {
  const { id } = useParams<{ id: string }>();
  const appId = id ?? "";
  const terminalRef = useRef<XtermSessionHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [status, setStatus] = useState<TerminalStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [uploadDir, setUploadDir] = useState("/tmp");
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const appQuery = useQuery({
    queryKey: ["app", appId],
    queryFn: () => api<{ app: PublicApp }>(`/api/apps/${appId}`),
    enabled: Boolean(appId),
  });

  const containersQuery = useQuery({
    queryKey: ["containers", appId],
    queryFn: () =>
      api<{ containers: AppContainer[]; uploadLimitMb: number }>(
        `/api/apps/${appId}/containers`,
      ),
    enabled: Boolean(appId),
    refetchInterval: 5_000,
  });

  const containers = containersQuery.data?.containers ?? [];
  const uploadLimitMb = containersQuery.data?.uploadLimitMb ?? 64;

  useEffect(() => {
    if (containers.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((current) => {
      if (current && containers.some((container) => container.id === current)) return current;
      const running = containers.find((container) => container.state === "running");
      return (running ?? containers[0])?.id ?? null;
    });
  }, [containersQuery.data]);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedId) throw new Error("Choose a container first.");
      if (file.size > uploadLimitMb * 1024 * 1024) {
        throw new Error(`"${file.name}" exceeds the ${uploadLimitMb} MB limit set in Settings.`);
      }
      const response = await fetch(
        `/api/apps/${appId}/containers/${selectedId}/files?path=${encodeURIComponent(
          uploadDir,
        )}&name=${encodeURIComponent(file.name)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: file,
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : `Upload failed with HTTP ${response.status}.`;
        throw new Error(message);
      }
      return body as { path: string };
    },
    onMutate: () => {
      setNotice(null);
      setUploadError(null);
    },
    onSuccess: (result) => setNotice(`Uploaded 1 file to ${result.path}`),
    onError: (uploadFailure) => setUploadError(errorMessage(uploadFailure)),
  });

  const selectedContainer = containers.find((container) => container.id === selectedId) ?? null;
  const statusLabel =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting…"
        : status === "error"
          ? "Connection error"
          : "Disconnected";

  if (appQuery.isPending) {
    return (
      <div className="mx-auto max-w-6xl">
        <Spinner label="Loading app…" />
      </div>
    );
  }

  if (appQuery.isError || !appQuery.data) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Link to="/" className="text-xs text-muted hover:text-ink">
          ← Back to applications
        </Link>
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {appQuery.isError ? errorMessage(appQuery.error) : "App not found."}
        </div>
      </div>
    );
  }

  const app = appQuery.data.app;

  return (
    <div className="mx-auto flex h-[calc(100dvh-13rem)] min-h-[420px] max-w-6xl flex-col gap-3 lg:h-[calc(100dvh-8.5rem)]">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/apps/${appId}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {app.name}
        </Link>
        <span className="text-xs text-muted">
          Container terminal
          {app.deployTarget === "remote" ? " · via SSH" : ""}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={selectedId ?? ""}
            onChange={(event) => {
              setSelectedId(event.target.value || null);
              setSessionKey((value) => value + 1);
              setNotice(null);
              setUploadError(null);
            }}
            disabled={containers.length === 0}
            aria-label="Container"
            className={cn(inputClass, "h-8 w-auto max-w-72 px-2 py-1 text-xs")}
          >
            {containers.length === 0 ? <option value="">No containers</option> : null}
            {containers.map((container) => (
              <option key={container.id} value={container.id}>
                {containerLabel(container)}
              </option>
            ))}
          </select>
          <input
            value={uploadDir}
            onChange={(event) => setUploadDir(event.target.value)}
            aria-label="Upload destination directory"
            placeholder="/tmp"
            className={cn(inputClass, "h-8 w-40 px-2 py-1 font-mono text-xs")}
          />
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) upload.mutate(file);
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!selectedId || upload.isPending}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            {upload.isPending ? "Uploading…" : "Upload file"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => terminalRef.current?.clear()}>
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </Button>
          <Button
            size="sm"
            disabled={!selectedId}
            onClick={() => setSessionKey((value) => value + 1)}
          >
            <PlugZap className="h-3.5 w-3.5" />
            Reconnect
          </Button>
        </div>
      </div>

      {notice ? (
        <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-2 text-xs text-success">
          {notice}
        </div>
      ) : null}
      {uploadError ? (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger">
          {uploadError}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-edge bg-panel">
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
            <span className="text-sm font-medium">
              {selectedContainer ? containerLabel(selectedContainer) : "No running container"}
            </span>
            <span className="text-xs text-muted">· {statusLabel}</span>
          </div>
          <span className="ml-auto text-[11px] text-muted">
            Uploads are extracted inside the container; max {uploadLimitMb} MB per file.
          </span>
        </header>

        {error ? (
          <div className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger">
            {error}
          </div>
        ) : null}

        {selectedId ? (
          <XtermSession
            key={`${selectedId}:${sessionKey}`}
            ref={terminalRef}
            url={`/api/terminal/apps/${appId}?container=${encodeURIComponent(selectedId)}`}
            onStatus={setStatus}
            onError={setError}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted">
            {containersQuery.isPending
              ? "Looking for containers…"
              : containersQuery.isError
                ? errorMessage(containersQuery.error)
                : "This app has no containers yet. Deploy it first, then reopen this terminal."}
          </div>
        )}

        <footer className="border-t border-edge px-4 py-1.5 text-[11px] text-muted">
          Docker exec into {app.deployTarget === "remote" ? "the remote host" : "this host"} · files land
          in the container filesystem, not on the panel.
        </footer>
      </div>
    </div>
  );
}
