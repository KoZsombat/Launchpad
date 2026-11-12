import { z } from "zod";
import { config } from "../config";

export interface GitHubRepo {
  owner: string;
  repo: string;
}

export const WORKFLOW_PATH = ".github/workflows/launchpad-deploy.yml";

export function parseGitHubRepo(repoUrl: string): GitHubRepo | null {
  const httpsMatch = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(
    repoUrl.trim(),
  );
  if (httpsMatch?.[1] && httpsMatch[2]) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  const sshMatch = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(repoUrl.trim());
  if (sshMatch?.[1] && sshMatch[2]) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }
  return null;
}

export function ghcrRepository(repoUrl: string): string | null {
  const parsed = parseGitHubRepo(repoUrl);
  if (!parsed) return null;
  return `ghcr.io/${parsed.owner}/${parsed.repo}`.toLowerCase();
}

export function ghcrLatestImage(repoUrl: string): string | null {
  const repository = ghcrRepository(repoUrl);
  return repository ? `${repository}:latest` : null;
}

function workflowDockerfilePath(buildContext: string, dockerfilePath: string): string {
  const context = buildContext.replace(/\/+$/, "");
  const normalizedContext = context === "." ? "" : context;
  const normalizedDockerfile = dockerfilePath.replace(/^\.\//, "");
  if (!normalizedContext) return normalizedDockerfile;
  if (normalizedDockerfile.startsWith(`${normalizedContext}/`)) return normalizedDockerfile;
  if (!normalizedDockerfile.includes("/")) return `${normalizedContext}/${normalizedDockerfile}`;
  return normalizedDockerfile;
}

export interface WorkflowOptions {
  appId: string;
  panelUrl: string;
  repoUrl: string;
  branch: string;
  buildContext: string;
  dockerfilePath: string;
}

export function generateWorkflow(options: WorkflowOptions): string {
  const parsed = parseGitHubRepo(options.repoUrl);
  if (!parsed) throw new Error("Only github.com repositories support GitHub Actions.");
  const image = `ghcr.io/${parsed.owner}/${parsed.repo}`.toLowerCase();
  const context = options.buildContext || ".";
  const dockerfile = workflowDockerfilePath(context, options.dockerfilePath || "Dockerfile");
  const panelUrl = options.panelUrl.replace(/\/$/, "");
  const branch = JSON.stringify(options.branch);

  return `name: Launchpad Deploy
on:
  push:
    branches: [${branch}]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

concurrency:
  group: launchpad-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build and push image
        uses: docker/build-push-action@v6
        with:
          context: ${JSON.stringify(context)}
          file: ${JSON.stringify(dockerfile)}
          push: true
          tags: |
            ${image}:\${{ github.sha }}
            ${image}:latest

      - name: Trigger Launchpad deployment
        run: |
          curl --fail-with-body -sS -X POST "${panelUrl}/api/hooks/deploy/${options.appId}" \\
            -H "Content-Type: application/json" \\
            -H "X-Launchpad-Secret: \${{ secrets.LAUNCHPAD_WEBHOOK_SECRET }}" \\
            -H "CF-Access-Client-Id: \${{ secrets.CF_ACCESS_CLIENT_ID }}" \\
            -H "CF-Access-Client-Secret: \${{ secrets.CF_ACCESS_CLIENT_SECRET }}" \\
            --data '{"imageTag":"${image}:\${{ github.sha }}","commitSha":"\${{ github.sha }}"}'
`;
}

const contentsResponseSchema = z.object({ sha: z.string() });
const errorResponseSchema = z.object({ message: z.string().optional() });

async function githubError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed = errorResponseSchema.safeParse(JSON.parse(text));
    if (parsed.success && parsed.data.message) return parsed.data.message;
  } catch {
    // Fall through to the raw response text.
  }
  return text || `GitHub API returned HTTP ${response.status}.`;
}

export interface CommitWorkflowOptions {
  repo: GitHubRepo;
  branch: string;
  token: string;
  yaml: string;
}

export async function commitWorkflowFile(
  options: CommitWorkflowOptions,
): Promise<{ committed: true } | { committed: false; error: string }> {
  const { repo, branch, token, yaml } = options;
  const base = `${config.githubApiUrl}/repos/${repo.owner}/${repo.repo}/contents/${WORKFLOW_PATH}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "launchpad",
    "Content-Type": "application/json",
  };

  const existing = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, {
    headers,
  });
  let sha: string | undefined;
  if (existing.ok) {
    const parsed = contentsResponseSchema.safeParse(await existing.json());
    if (!parsed.success) {
      return { committed: false, error: "Unexpected response from the GitHub contents API." };
    }
    sha = parsed.data.sha;
  } else if (existing.status !== 404) {
    return { committed: false, error: await githubError(existing) };
  }

  const response = await fetch(base, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: "Add Launchpad deploy workflow",
      content: Buffer.from(yaml, "utf8").toString("base64"),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!response.ok) {
    return { committed: false, error: await githubError(response) };
  }
  return { committed: true };
}
