import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Cpu,
  ExternalLink,
  MemoryStick,
  Play,
  Plus,
  RotateCw,
  Square,
  SquareTerminal,
  TerminalSquare,
} from "lucide-react";
import type { HostStats, PublicApp } from "@launchpad/shared";
import { api, apiJson, errorMessage } from "../lib/api";
import { formatBytes, formatRelative, hostCpuShare } from "../lib/format";
import {
  DeploymentBadge,
  EmptyState,
  StatusBadge,
  UsageCard,
  UsageCardSkeleton,
} from "../components/ui";
import { cn } from "../components/ui";

type AppAction = "deploy" | "restart" | "stop" | "start";

export function DashboardPage() {
  const queryClient = useQueryClient();
  const appsQuery = useQuery({
    queryKey: ["apps"],
    queryFn: () => api<{ apps: PublicApp[] }>("/api/apps"),
    refetchInterval: 10_000,
  });

  const statsQuery = useQuery({
    queryKey: ["host-stats"],
    queryFn: () => api<{ stats: HostStats }>("/api/stats"),
    refetchInterval: 1_000,
  });

  const action = useMutation({
    mutationFn: ({ id, action }: { id: string; action: AppAction }) =>
      apiJson<{ ok?: boolean; deployment?: unknown }>(`/api/apps/${id}/${action}`, "POST"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["apps"] });
    },
  });

  const apps = appsQuery.data?.apps ?? [];
  const activeAction = action.isPending ? action.variables : null;
  const hostStats = statsQuery.data?.stats ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Applications</h1>
          <p className="mt-1 text-sm text-muted">
            Containers, compose projects, bots and workers — with a Traefik route, a published
            port, or no ingress at all.
          </p>
        </div>
        <Link
          to="/apps/new"
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink shadow-sm transition hover:brightness-110"
        >
          <Plus className="h-4 w-4" />
          New app
        </Link>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {hostStats ? (
          <>
            <UsageCard
              icon={<Cpu className="h-3.5 w-3.5" />}
              label="Container CPU"
              value={`${hostCpuShare(hostStats.cpuPercent, hostStats.hostCpuCount).toFixed(1)}%`}
              detail={`${hostStats.containerCount} running · ${hostStats.cpuPercent.toFixed(1)}% across ${
                hostStats.hostCpuCount
              } core${hostStats.hostCpuCount === 1 ? "" : "s"}`}
              percent={hostCpuShare(hostStats.cpuPercent, hostStats.hostCpuCount)}
            />
            <UsageCard
              icon={<MemoryStick className="h-3.5 w-3.5" />}
              label="Container memory"
              value={formatBytes(hostStats.memoryBytes)}
              detail={`of ${formatBytes(hostStats.hostMemoryBytes)} on the host`}
              percent={
                hostStats.hostMemoryBytes > 0
                  ? (hostStats.memoryBytes / hostStats.hostMemoryBytes) * 100
                  : 0
              }
            />
          </>
        ) : statsQuery.isError ? (
          <p className="rounded-lg border border-edge bg-panel px-4 py-3 text-xs text-muted sm:col-span-2">
            Container usage is unavailable: {errorMessage(statsQuery.error)}
          </p>
        ) : (
          <>
            <UsageCardSkeleton label="Container CPU" />
            <UsageCardSkeleton label="Container memory" />
          </>
        )}
      </div>

      {action.isError ? (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {errorMessage(action.error)}
        </div>
      ) : null}

      {appsQuery.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-44 animate-pulse rounded-xl border border-edge bg-panel" />
          ))}
        </div>
      ) : appsQuery.isError ? (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {errorMessage(appsQuery.error)}
        </div>
      ) : apps.length === 0 ? (
        <EmptyState
          title="No apps yet"
          description="Deploy your first container from an image, a GitHub repository or a docker-compose project."
          action={
            <Link
              to="/apps/new"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink"
            >
              <Plus className="h-4 w-4" />
              Deploy an app
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {apps.map((app) => {
            const busy = activeAction?.id === app.id;
            const last = app.lastDeployment;
            return (
              <article
                key={app.id}
                className="group flex flex-col rounded-xl border border-edge bg-panel p-5 transition-colors hover:border-muted/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      to={`/apps/${app.id}`}
                      className="block truncate text-base font-semibold tracking-tight hover:text-accent"
                    >
                      {app.name}
                    </Link>
                    {app.access === "http" ? (
                      <a
                        href={app.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted hover:text-accent"
                      >
                        {app.subdomain}
                        {app.subdomains.length > 1 ? (
                          <span className="text-[10px] text-muted">
                            +{app.subdomains.length - 1}
                          </span>
                        ) : null}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
                        {app.access === "port"
                          ? `port ${app.hostPort ?? app.internalPort}/${app.portProtocol}`
                          : "background service"}
                      </span>
                    )}
                  </div>
                  <StatusBadge status={app.status} />
                </div>

                <div className="mt-4 flex items-center gap-2 text-xs text-muted">
                  <span className="rounded-md border border-edge bg-panel-2 px-2 py-1 font-mono uppercase">
                    {app.sourceType}
                  </span>
                  <span className="truncate font-mono">
                    {app.sourceType === "image"
                      ? app.imageRef
                      : app.sourceType === "compose"
                        ? `${app.composeServices.filter((service) => service.expose).length} routed`
                        : app.branch}
                  </span>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-edge pt-3 text-xs text-muted">
                  <div className="flex items-center gap-2">
                    {last ? <DeploymentBadge status={last.status} /> : <span>No deploys</span>}
                    <span>· {formatRelative(last?.queuedAt)}</span>
                  </div>
                  <span className="font-mono">{app.internalPort}</span>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => action.mutate({ id: app.id, action: "deploy" })}
                    disabled={busy}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-edge bg-panel-2 px-2.5 text-xs text-ink transition hover:border-accent/40 hover:text-accent disabled:opacity-50"
                  >
                    <RotateCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
                    Redeploy
                  </button>
                  {app.status === "stopped" ? (
                    <button
                      onClick={() => action.mutate({ id: app.id, action: "start" })}
                      disabled={busy}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-edge bg-panel-2 px-2.5 text-xs text-ink transition hover:border-success/40 hover:text-success disabled:opacity-50"
                    >
                      <Play className="h-3.5 w-3.5" />
                      Start
                    </button>
                  ) : (
                    <button
                      onClick={() => action.mutate({ id: app.id, action: "stop" })}
                      disabled={busy}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-edge bg-panel-2 px-2.5 text-xs text-ink transition hover:border-danger/40 hover:text-danger disabled:opacity-50"
                    >
                      <Square className="h-3.5 w-3.5" />
                      Stop
                    </button>
                  )}
                  {app.status === "running" ? (
                    <Link
                      to={`/apps/${app.id}/terminal`}
                      title={`Open terminal for ${app.name}`}
                      aria-label={`Open terminal for ${app.name}`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted transition hover:bg-panel-2 hover:text-ink"
                    >
                      <SquareTerminal className="h-3.5 w-3.5" />
                    </Link>
                  ) : null}
                  <Link
                    to={`/apps/${app.id}`}
                    className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted transition hover:bg-panel-2 hover:text-ink"
                  >
                    <TerminalSquare className="h-3.5 w-3.5" />
                    Details
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
