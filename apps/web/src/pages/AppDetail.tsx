import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ExternalLink,
  History,
  Play,
  RotateCw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type {
  DeploymentSummary,
  PublicApp,
} from "@launchpad/shared";
import { api, apiJson, errorMessage } from "../lib/api";
import { formatDateTime, formatRelative, shortId } from "../lib/format";
import {
  Button,
  DeploymentBadge,
  Modal,
  Panel,
  Spinner,
  StatusBadge,
  cn,
} from "../components/ui";
import { ConfigEditor, type AppConfigUpdate } from "../components/ConfigEditor";
import { CicdPanel } from "../components/CicdPanel";
import {
  ContainerLogsPanel,
  DeploymentLogViewer,
} from "../components/DeploymentLogs";

type ActionKind = "deploy" | "restart" | "stop" | "start";

interface ActionResponse {
  ok?: boolean;
  deployment?: DeploymentSummary;
}

export function AppDetailPage() {
  const { id } = useParams<{ id: string }>();
  const appId = id ?? "";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [selectedDeployment, setSelectedDeployment] = useState<string | null>(
    searchParams.get("deployment"),
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [configNotice, setConfigNotice] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [removeVolumes, setRemoveVolumes] = useState(false);

  useEffect(() => {
    const fromQuery = searchParams.get("deployment");
    if (fromQuery) setSelectedDeployment(fromQuery);
  }, [searchParams]);

  const appQuery = useQuery({
    queryKey: ["app", appId],
    queryFn: () => api<{ app: PublicApp }>(`/api/apps/${appId}`),
    enabled: Boolean(appId),
    refetchInterval: 5_000,
  });

  const deploymentsQuery = useQuery({
    queryKey: ["deployments", appId],
    queryFn: () => api<{ deployments: DeploymentSummary[] }>(`/api/apps/${appId}/deployments`),
    enabled: Boolean(appId),
    refetchInterval: 4_000,
  });

  const action = useMutation({
    mutationFn: (kind: ActionKind) =>
      apiJson<ActionResponse>(`/api/apps/${appId}/${kind}`, "POST"),
    onMutate: () => setActionError(null),
    onSuccess: (result, kind) => {
      void queryClient.invalidateQueries({ queryKey: ["app", appId] });
      void queryClient.invalidateQueries({ queryKey: ["deployments", appId] });
      void queryClient.invalidateQueries({ queryKey: ["apps"] });
      if (kind === "deploy" && result.deployment) {
        setSelectedDeployment(result.deployment.id);
      }
    },
    onError: (error) => setActionError(errorMessage(error)),
  });

  const saveConfig = useMutation({
    mutationFn: (update: AppConfigUpdate) =>
      apiJson<{ app: PublicApp; deployment: DeploymentSummary | null }>(
        `/api/apps/${appId}`,
        "PATCH",
        update,
      ),
    onMutate: () => {
      setActionError(null);
      setConfigNotice(null);
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["app", appId] });
      void queryClient.invalidateQueries({ queryKey: ["deployments", appId] });
      void queryClient.invalidateQueries({ queryKey: ["apps"] });
      if (result.deployment) {
        setSelectedDeployment(result.deployment.id);
        setConfigNotice("Configuration saved. A new deployment was queued.");
      } else {
        setConfigNotice("Configuration saved. No deployment-affecting values changed.");
      }
    },
    onError: (error) => setActionError(errorMessage(error)),
  });

  const toggleCicd = useMutation({
    mutationFn: (enabled: boolean) =>
      apiJson<{ app: PublicApp }>(`/api/apps/${appId}`, "PATCH", { cicdEnabled: enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["app", appId] });
      void queryClient.invalidateQueries({ queryKey: ["cicd", appId] });
    },
    onError: (error) => setActionError(errorMessage(error)),
  });

  const removeApp = useMutation({
    mutationFn: () =>
      apiJson<{ ok: boolean; warnings: string[] }>(
        `/api/apps/${appId}?removeVolumes=${removeVolumes ? "true" : "false"}`,
        "DELETE",
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["apps"] });
      navigate("/");
    },
    onError: (error) => setActionError(errorMessage(error)),
  });

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
  const deployments = deploymentsQuery.data?.deployments ?? [];
  const busyAction = action.isPending ? action.variables : null;
  const selected = selectedDeployment
    ? deployments.find((deployment) => deployment.id === selectedDeployment) ?? null
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to applications
        </Link>
      </div>

      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{app.name}</h1>
            <StatusBadge status={app.status} />
          </div>
          <a
            href={app.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted hover:text-accent"
          >
            {app.url}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={action.isPending}
            onClick={() => action.mutate("deploy")}
          >
            <RotateCw className={cn("h-3.5 w-3.5", busyAction === "deploy" && "animate-spin")} />
            {busyAction === "deploy" ? "Deploying…" : "Redeploy"}
          </Button>
          <Button
            size="sm"
            disabled={action.isPending}
            onClick={() => action.mutate("restart")}
          >
            <RotateCw className="h-3.5 w-3.5" />
            Restart
          </Button>
          {app.status === "stopped" ? (
            <Button size="sm" disabled={action.isPending} onClick={() => action.mutate("start")}>
              <Play className="h-3.5 w-3.5" />
              Start
            </Button>
          ) : (
            <Button size="sm" disabled={action.isPending} onClick={() => action.mutate("stop")}>
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </header>

      {actionError ? (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {actionError}
        </div>
      ) : null}
      {configNotice ? (
        <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          {configNotice}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetaCard label="Source" value={app.sourceType === "image" ? app.imageRef ?? "—" : app.repoUrl ?? "—"} mono />
        <MetaCard label="Internal port" value={String(app.internalPort)} mono />
        <MetaCard
          label="Last deploy"
          value={app.lastDeployment ? formatRelative(app.lastDeployment.queuedAt) : "never"}
          hint={app.lastDeployment ? formatDateTime(app.lastDeployment.queuedAt) : undefined}
        />
        <MetaCard label="Container" value={app.containerId ? shortId(app.containerId) : "—"} mono />
      </div>

      <Panel
        title={
          <span className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Deployments
          </span>
        }
        description="Click a deployment to stream or inspect its log."
        actions={
          deploymentsQuery.isFetching ? (
            <span className="text-[11px] text-muted">Refreshing…</span>
          ) : null
        }
      >
        {deployments.length === 0 ? (
          <p className="text-sm text-muted">No deployments yet.</p>
        ) : (
          <div className="divide-y divide-edge overflow-hidden rounded-lg border border-edge">
            {deployments.map((deployment) => (
              <button
                key={deployment.id}
                onClick={() => setSelectedDeployment(deployment.id)}
                className={cn(
                  "flex w-full flex-wrap items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-panel-2",
                  selectedDeployment === deployment.id && "bg-accent/5",
                )}
              >
                <DeploymentBadge status={deployment.status} />
                <span className="text-xs capitalize text-muted">{deployment.trigger}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
                  {deployment.imageTag ?? "—"}
                  {deployment.commitSha ? ` · ${deployment.commitSha.slice(0, 7)}` : ""}
                </span>
                <span className="text-[11px] text-muted">
                  {formatRelative(deployment.queuedAt)}
                </span>
              </button>
            ))}
          </div>
        )}

        {selectedDeployment ? (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
                Deployment {shortId(selectedDeployment)}
                {selected ? ` · ${formatDateTime(selected.queuedAt)}` : ""}
              </h3>
              <button
                className="rounded-md p-1 text-muted hover:bg-panel-2 hover:text-ink"
                onClick={() => setSelectedDeployment(null)}
                aria-label="Close logs"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <DeploymentLogViewer appId={appId} deploymentId={selectedDeployment} />
          </div>
        ) : null}
      </Panel>

      <ConfigEditor
        key={app.updatedAt}
        app={app}
        saving={saveConfig.isPending}
        onSave={(update) => saveConfig.mutate(update)}
      />

      <CicdPanel
        app={app}
        toggling={toggleCicd.isPending}
        onToggle={(enabled) => toggleCicd.mutate(enabled)}
      />

      <Panel
        title="Container logs"
        description="Live stdout/stderr from the running container."
      >
        <ContainerLogsPanel appId={appId} hasContainer={Boolean(app.containerId)} />
      </Panel>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`Delete ${app.name}?`}
        footer={
          <>
            <Button size="sm" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={removeApp.isPending}
              onClick={() => removeApp.mutate()}
            >
              {removeApp.isPending ? "Deleting…" : "Delete app"}
            </Button>
          </>
        }
      >
        <p>
          This stops and removes the container and deletes the app and its deployment history. The
          Traefik route disappears with the container.
        </p>
        <label className="mt-4 flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            className="mt-0.5 accent-[var(--accent)]"
            checked={removeVolumes}
            onChange={(event) => setRemoveVolumes(event.target.checked)}
          />
          Also remove the named Docker volumes ({app.volumes.length}). This deletes their data.
        </label>
      </Modal>
    </div>
  );
}

function MetaCard({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-edge bg-panel px-4 py-3">
      <div className="text-[10px] font-medium uppercase tracking-widest text-muted">{label}</div>
      <div className={cn("mt-1 truncate text-sm", mono && "font-mono text-xs")}>{value}</div>
      {hint ? <div className="mt-0.5 text-[10px] text-muted">{hint}</div> : null}
    </div>
  );
}
