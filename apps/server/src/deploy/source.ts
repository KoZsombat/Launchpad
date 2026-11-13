import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ignore from "ignore";
import tar from "tar-fs";
import type { AppRow } from "../db/schema";
import { docker } from "../docker/client";
import { config } from "../config";
import { getRepoToken } from "../services/apps";

const execFileAsync = promisify(execFile);

function redact(text: string, token: string | null): string {
  let result = text;
  if (token) result = result.split(token).join("********");
  return result.replace(/https:\/\/[^@\s/]+@/g, "https://********@");
}

async function runGit(
  args: string[],
  options: { cwd?: string; token?: string | null; log: (line: string) => void },
): Promise<string> {
  const token = options.token ?? null;
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd: options.cwd,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    for (const line of redact(stderr, token).split("\n")) {
      if (line.trim()) options.log(line.trimEnd());
    }
    return stdout;
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message: string };
    const detail = redact(
      [failure.stderr, failure.stdout, failure.message].filter(Boolean).join("\n"),
      token,
    );
    throw new Error(`git ${args[0] ?? ""} failed: ${detail.trim()}`);
  }
}

function authenticatedRepoUrl(repoUrl: string, token: string | null): string {
  if (!token || !repoUrl.startsWith("https://")) return repoUrl;
  const url = new URL(repoUrl);
  url.username = "x-access-token";
  url.password = token;
  return url.toString();
}

export interface PreparedRepo {
  repoDir: string;
  sha: string;
  shortSha: string;
  imageTag: string;
}

export async function prepareRepo(app: AppRow, log: (line: string) => void): Promise<PreparedRepo> {
  if (!app.repoUrl || !app.branch) {
    throw new Error("This app is missing its GitHub repository configuration.");
  }
  const token = getRepoToken(app);
  const repoDir = path.join(config.reposDir, app.id);
  const gitDir = path.join(repoDir, ".git");
  await fsp.mkdir(config.reposDir, { recursive: true });

  if (fs.existsSync(gitDir)) {
    log(`Fetching branch "${app.branch}" from origin...`);
    await runGit(
      [
        "-C",
        repoDir,
        "fetch",
        "--depth",
        "1",
        authenticatedRepoUrl(app.repoUrl, token),
        app.branch,
      ],
      { token, log },
    );
    await runGit(["-C", repoDir, "checkout", "-f", "FETCH_HEAD"], { token, log });
  } else {
    log(`Cloning ${app.repoUrl} (branch ${app.branch})...`);
    await fsp.rm(repoDir, { recursive: true, force: true });
    await fsp.mkdir(repoDir, { recursive: true });
    await runGit(
      [
        "clone",
        "--depth",
        "1",
        "--branch",
        app.branch,
        "--single-branch",
        authenticatedRepoUrl(app.repoUrl, token),
        repoDir,
      ],
      { token, log },
    );
    // Never persist the access token in .git/config.
    await runGit(["-C", repoDir, "remote", "set-url", "origin", app.repoUrl], {
      log,
    });
  }

  const sha = (
    await runGit(["-C", repoDir, "rev-parse", "HEAD"], { token, log })
  ).trim();
  const shortSha = (
    await runGit(["-C", repoDir, "rev-parse", "--short=7", "HEAD"], { token, log })
  ).trim();
  return { repoDir, sha, shortSha, imageTag: `${app.name}:${shortSha}` };
}

function resolveContext(repoDir: string, buildContext: string): string {
  const contextDir = path.resolve(repoDir, buildContext);
  const relative = path.relative(repoDir, contextDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Build context must be inside the repository.");
  }
  if (!fs.existsSync(contextDir) || !fs.statSync(contextDir).isDirectory()) {
    throw new Error(`Build context "${buildContext}" was not found in the repository.`);
  }
  return contextDir;
}

function resolveDockerfile(
  repoDir: string,
  contextDir: string,
  dockerfilePath: string,
): string {
  const candidates = [
    path.resolve(repoDir, dockerfilePath),
    path.resolve(contextDir, dockerfilePath),
  ];
  const found = candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
  if (!found) {
    throw new Error(`Dockerfile "${dockerfilePath}" was not found in the repository.`);
  }
  const relative = path.relative(contextDir, found);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Dockerfile must be inside the build context.");
  }
  return relative.split(path.sep).join("/");
}

function dockerignoreFilter(contextDir: string): (name: string) => boolean {
  const matcher = ignore();
  matcher.add([".git", ".git/**"]);
  const ignoreFile = path.join(contextDir, ".dockerignore");
  if (fs.existsSync(ignoreFile)) {
    matcher.add(fs.readFileSync(ignoreFile, "utf8"));
  }
  return (name: string) => {
    const normalized = name.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
    if (!normalized) return false;
    if (normalized === ".git" || normalized.startsWith(".git/")) return true;
    try {
      return matcher.ignores(normalized);
    } catch {
      return false;
    }
  };
}

export interface BuiltImage {
  imageTag: string;
  commitSha: string;
}

/** Clones/fetches the branch, builds the image and tags it <app>:<short-sha>. */
export async function buildImageFromRepo(
  app: AppRow,
  log: (line: string) => void,
): Promise<BuiltImage> {
  const prepared = await prepareRepo(app, log);
  const buildContext = app.buildContext || ".";
  const dockerfilePath = app.dockerfilePath || "Dockerfile";
  const contextDir = resolveContext(prepared.repoDir, buildContext);
  const dockerfile = resolveDockerfile(prepared.repoDir, contextDir, dockerfilePath);

  log(`Building image ${prepared.imageTag} (context "${buildContext}", Dockerfile "${dockerfile}")...`);
  const stream = tar.pack(contextDir, { ignore: dockerignoreFilter(contextDir) });
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  docker.buildImage(
    stream,
    { t: prepared.imageTag, dockerfile },
    (error, output) => {
      if (error) {
        reject(error);
        return;
      }
      if (!output) {
        reject(new Error("Docker build returned no output stream."));
        return;
      }
      docker.modem.followProgress(
        output,
        (progressError) => (progressError ? reject(progressError) : resolve()),
        (event: { stream?: string; error?: string }) => {
          if (event.error) log(`Build error: ${event.error}`);
          if (event.stream) {
            for (const line of event.stream.split("\n")) {
              if (line.trim()) log(line.trimEnd());
            }
          }
        },
      );
    },
  );

  await promise;
  log(`Built image ${prepared.imageTag} from commit ${prepared.sha}.`);
  return { imageTag: prepared.imageTag, commitSha: prepared.sha };
}

const COMPOSE_CANDIDATES = [
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
];

function findComposeFile(
  root: string,
  composePath: string | null,
): { text: string; path: string } {
  const candidates = composePath ? [composePath] : COMPOSE_CANDIDATES;
  for (const candidate of candidates) {
    const absolute = path.resolve(root, candidate);
    const relative = path.relative(root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Compose path must be inside the repository.");
    }
    try {
      if (fs.statSync(absolute).isFile()) {
        return { text: fs.readFileSync(absolute, "utf8"), path: candidate };
      }
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(
    `Compose file "${composePath ?? COMPOSE_CANDIDATES[0]}" was not found in the repository.`,
  );
}

/**
 * Clones/fetches the app's repository and returns the compose file at
 * `composePath` (or the first conventional compose filename at the root).
 */
export async function readRepoCompose(
  app: AppRow,
  log: (line: string) => void,
): Promise<{ text: string; sha: string; path: string; projectDir: string }> {
  const prepared = await prepareRepo(app, log);
  const found = findComposeFile(prepared.repoDir, app.composePath);
  return {
    ...found,
    sha: prepared.sha,
    projectDir: path.dirname(path.join(prepared.repoDir, found.path)),
  };
}

export interface RepoComposeRequest {
  repoUrl: string;
  branch: string;
  token: string | null;
  composePath: string | null;
  log: (line: string) => void;
}

/** Clones a repository into a throwaway directory and reads one compose file. */
export async function fetchComposeFromRepo(
  request: RepoComposeRequest,
): Promise<{ text: string; path: string }> {
  await fsp.mkdir(config.reposDir, { recursive: true });
  const dir = await fsp.mkdtemp(path.join(config.reposDir, "scan-"));
  try {
    await runGit(
      [
        "clone",
        "--depth",
        "1",
        "--branch",
        request.branch,
        "--single-branch",
        authenticatedRepoUrl(request.repoUrl, request.token),
        dir,
      ],
      { token: request.token, log: request.log },
    );
    return findComposeFile(dir, request.composePath);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}
