import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, EyeOff, GitCommitHorizontal, KeyRound } from "lucide-react";
import type { GithubPushInfo, PublicApp } from "@launchpad/shared";
import { api, errorMessage } from "../lib/api";
import { Button, CopyButton, Panel, Spinner } from "./ui";

export function GitHubPushPanel({ app }: { app: PublicApp }) {
  const [revealed, setRevealed] = useState(false);
  const query = useQuery({
    queryKey: ["github-push", app.id],
    queryFn: () => api<{ githubPush: GithubPushInfo }>(`/api/apps/${app.id}/github-push`),
    enabled: Boolean(app.repoUrl),
  });

  const info = query.data?.githubPush;

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <GitCommitHorizontal className="h-4 w-4" />
          GitHub push deploys
        </span>
      }
      description="Push to the configured branch and Launchpad re-reads the compose file from the repository, then deploys the stack."
    >
      {query.isPending ? <Spinner label="Preparing webhook details…" /> : null}
      {query.isError ? (
        <p className="text-sm text-danger">{errorMessage(query.error)}</p>
      ) : null}

      {info ? (
        <div className="space-y-5">
          <div>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
              Payload URL
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
              <CopyButton value={info.webhookSecret} />
            </div>
          </div>

          <ol className="list-decimal space-y-1.5 rounded-lg border border-edge bg-panel-2/50 p-4 pl-8 text-xs text-muted">
            <li>Open the repository on GitHub → Settings → Webhooks → Add webhook.</li>
            <li>Payload URL: the URL above. Content type: application/json.</li>
            <li>Secret: the webhook secret above.</li>
            <li>Events: “Just the push event”.</li>
            <li>
              Pushes to <code className="font-mono">{info.branch}</code> queue a deployment.
              Launchpad verifies X-Hub-Signature-256 and re-reads the compose file, including any
              build contexts.
            </li>
          </ol>

          <p className="text-[11px] text-muted">
            No Actions workflow is generated for compose projects; this push webhook is the
            deploy trigger.
          </p>
        </div>
      ) : null}
    </Panel>
  );
}
