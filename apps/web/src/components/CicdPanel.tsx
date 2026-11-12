import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Eye, EyeOff, GitCommitHorizontal, KeyRound, Workflow } from "lucide-react";
import type { CicdInfo, PublicApp } from "@launchpad/shared";
import { api, apiJson, errorMessage } from "../lib/api";
import { Button, CopyButton, Panel, Spinner, Toggle } from "./ui";

export function CicdPanel({
  app,
  toggling,
  onToggle,
}: {
  app: PublicApp;
  toggling: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [showYaml, setShowYaml] = useState(false);

  const cicdQuery = useQuery({
    queryKey: ["cicd", app.id],
    queryFn: () => api<{ cicd: CicdInfo }>(`/api/apps/${app.id}/cicd`),
    enabled: app.sourceType === "github",
  });

  const commit = useMutation({
    mutationFn: () =>
      apiJson<{ committed: boolean; error?: string; path: string; yaml: string }>(
        `/api/apps/${app.id}/cicd/workflow`,
        "POST",
      ),
  });

  if (app.sourceType !== "github") {
    return (
      <Panel title="CI/CD with GitHub Actions">
        <p className="text-sm text-muted">
          CI/CD is only available for apps built from a GitHub repository.
        </p>
      </Panel>
    );
  }

  const info = cicdQuery.data?.cicd;
  const panelHost = info ? new URL(info.panelUrl).host : "";

  return (
    <Panel
      title="CI/CD with GitHub Actions"
      description="The workflow builds and pushes to GHCR, then calls Launchpad's deploy webhook."
      actions={
        <Toggle
          label="Enable CI/CD"
          checked={app.cicdEnabled}
          disabled={toggling}
          onChange={onToggle}
        />
      }
    >
      {cicdQuery.isPending ? <Spinner label="Preparing CI/CD details…" /> : null}
      {cicdQuery.isError ? (
        <p className="text-sm text-danger">{errorMessage(cicdQuery.error)}</p>
      ) : null}

      {info ? (
        <div className="space-y-5">
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
              <Workflow className="h-3.5 w-3.5" />
              Deploy webhook
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-edge bg-panel-2 px-3 py-2 font-mono text-xs">
                {info.webhookUrl}
              </code>
              <CopyButton value={info.webhookUrl} />
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
              <KeyRound className="h-3.5 w-3.5" />
              Webhook secret
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-edge bg-panel-2 px-3 py-2 font-mono text-xs">
                {revealed ? info.webhookSecret : "•".repeat(48)}
              </code>
              <Button size="sm" onClick={() => setRevealed((value) => !value)}>
                {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {revealed ? "Hide" : "Reveal"}
              </Button>
              <CopyButton value={info.webhookSecret} label="Copy" />
            </div>
            <p className="mt-1.5 text-[11px] text-muted">
              Sent as the <code className="font-mono">X-Launchpad-Secret</code> header and compared
              in constant time.
            </p>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
              GitHub repository secrets
            </div>
            <div className="overflow-hidden rounded-lg border border-edge">
              <table className="w-full text-left text-xs">
                <thead className="bg-panel-2 text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge">
                  {info.secrets.map((secret) => (
                    <tr key={secret.name}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono">{secret.name}</td>
                      <td className="px-3 py-2 text-muted">
                        {secret.value ? (
                          <span className="font-mono">{secret.value}</span>
                        ) : (
                          secret.description
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-edge bg-panel-2/50 p-4 text-xs text-muted">
            <p className="font-medium text-ink">Cloudflare Access setup</p>
            <ol className="list-decimal space-y-1.5 pl-4">
              <li>
                In Cloudflare Zero Trust → Access → Service Auth, create a service token for this
                workflow.
              </li>
              <li>
                Add the service token to the Access application protecting{" "}
                <code className="font-mono">{panelHost}</code> with an “Allow / Service Auth”
                policy.
              </li>
              <li>
                Put the token values in the GitHub secrets{" "}
                <code className="font-mono">CF_ACCESS_CLIENT_ID</code> and{" "}
                <code className="font-mono">CF_ACCESS_CLIENT_SECRET</code>.
              </li>
              <li>
                Alternative: create an Access <strong className="text-ink">Bypass</strong> policy
                for path <code className="font-mono">/api/hooks/*</code>. Less secure — the webhook
                secret is then the only protection.
              </li>
              <li>
                GHCR: the workflow pushes with <code className="font-mono">GITHUB_TOKEN</code>. Make
                the package readable or store a <code className="font-mono">read:packages</code>{" "}
                token under Settings → GHCR.
              </li>
            </ol>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={!info.githubTokenSet || commit.isPending}
              onClick={() => commit.mutate()}
            >
              <GitCommitHorizontal className="h-3.5 w-3.5" />
              {commit.isPending ? "Committing…" : "Commit workflow to repo"}
            </Button>
            <CopyButton value={info.workflowYaml} label="Copy workflow YAML" />
            <Button size="sm" variant="ghost" onClick={() => setShowYaml((value) => !value)}>
              {showYaml ? "Hide YAML" : "Show YAML"}
            </Button>
            {!info.githubTokenSet ? (
              <span className="text-[11px] text-muted">
                Add a GitHub token in Settings to commit automatically.
              </span>
            ) : null}
          </div>

          {commit.data ? (
            <p
              className={
                commit.data.committed
                  ? "text-xs text-success"
                  : "text-xs text-danger"
              }
            >
              {commit.data.committed
                ? `Workflow committed to ${commit.data.path}.`
                : `Could not commit workflow: ${commit.data.error ?? "unknown error"}`}
            </p>
          ) : null}
          {commit.isError ? (
            <p className="text-xs text-danger">{errorMessage(commit.error)}</p>
          ) : null}

          {showYaml ? (
            <pre className="max-h-96 overflow-auto rounded-lg border border-edge bg-[#080b11] p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
              {info.workflowYaml}
            </pre>
          ) : null}

          {!app.cicdEnabled ? (
            <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              CI/CD is currently disabled. The workflow will still call this URL if it is present in
              the repository. Enable the toggle above to use Actions-driven deploys.
            </p>
          ) : null}
        </div>
      ) : null}

      {!app.cicdEnabled && info ? (
        <div className="mt-5 space-y-2 border-t border-edge pt-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Plain GitHub push webhook
          </p>
          <code className="block truncate rounded-lg border border-edge bg-panel-2 px-3 py-2 font-mono text-xs">
            {info.githubPushWebhookUrl}
          </code>
          <p className="text-[11px] text-muted">
            Repository → Settings → Webhooks → Add webhook. Payload URL above, content type{" "}
            <code className="font-mono">application/json</code>, secret = the webhook secret, event
            “Just the push event”. Launchpad verifies{" "}
            <code className="font-mono">X-Hub-Signature-256</code> and builds the branch itself.
          </p>
        </div>
      ) : null}
    </Panel>
  );
}
