import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  GitBranch,
  Globe2,
  Image as ImageIcon,
  Layers,
  Rocket,
  XCircle,
} from "lucide-react";
import {
  createAppSchema,
  validateSlug,
  validateSubdomain,
  type AvailabilityResult,
  type DeploymentSummary,
  type PublicApp,
  type ScanComposeResponse,
  type SettingsView,
} from "@launchpad/shared";
import {
  ApiRequestError,
  api,
  apiJson,
  errorMessage,
  validationIssues,
} from "../lib/api";
import {
  Button,
  Field,
  Panel,
  Toggle,
  cn,
  inputClass,
} from "../components/ui";
import {
  EnvEditor,
  VolumesEditor,
  type EnvRowState,
  type VolumeRowState,
} from "../components/EnvEditor";
import {
  ComposeBuilder,
  composeStateFromScan,
  initialComposeState,
  type ComposeFormState,
} from "../components/ComposeBuilder";

interface FormState {
  name: string;
  subdomain: string;
  domain: string;
  sourceType: "image" | "github" | "compose";
  imageRef: string;
  registryUsername: string;
  registryPassword: string;
  repoUrl: string;
  branch: string;
  dockerfilePath: string;
  buildContext: string;
  repoToken: string;
  internalPort: string;
  healthPath: string;
  envVars: EnvRowState[];
  volumes: VolumeRowState[];
  cicdEnabled: boolean;
}

const initialForm: FormState = {
  name: "",
  subdomain: "",
  domain: "",
  sourceType: "image",
  imageRef: "",
  registryUsername: "",
  registryPassword: "",
  repoUrl: "",
  branch: "main",
  dockerfilePath: "Dockerfile",
  buildContext: ".",
  repoToken: "",
  internalPort: "3000",
  healthPath: "/",
  envVars: [],
  volumes: [],
  cicdEnabled: false,
};

export function NewAppPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<AvailabilityResult | null>(null);
  const [subdomainTouched, setSubdomainTouched] = useState(false);
  const [compose, setCompose] = useState<ComposeFormState>(initialComposeState);
  const [composeError, setComposeError] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<{ settings: SettingsView }>("/api/settings"),
  });
  const baseDomain = settingsQuery.data?.settings.baseDomain ?? "your-domain.com";

  useEffect(() => {
    if (!form.name) {
      setAvailability(null);
      return;
    }
    if (!validateSlug(form.name).ok) {
      setAvailability(null);
      return;
    }
    if (form.sourceType !== "compose" && !validateSubdomain(form.subdomain).ok) {
      setAvailability(null);
      return;
    }
    const domain = form.domain.trim();
    const query =
      (form.sourceType === "compose"
        ? `name=${encodeURIComponent(form.name)}`
        : `name=${encodeURIComponent(form.name)}&subdomain=${encodeURIComponent(form.subdomain)}`) +
      (domain ? `&domain=${encodeURIComponent(domain)}` : "");
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<AvailabilityResult>(`/api/apps/availability?${query}`, {
        signal: controller.signal,
      })
        .then((result) => {
          if (!controller.signal.aborted) setAvailability(result);
        })
        .catch(() => {
          /* Availability is advisory; the server still enforces uniqueness. */
        });
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [form.name, form.subdomain, form.domain, form.sourceType]);

  const create = useMutation({
    mutationFn: (payload: unknown) =>
      apiJson<{ app: PublicApp; deployment: DeploymentSummary }>("/api/apps", "POST", payload),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["apps"] });
      navigate(`/apps/${result.app.id}?deployment=${result.deployment.id}`);
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.details && typeof error.details === "object") {
        const details = error.details;
        if ("field" in details && typeof details.field === "string") {
          const field = details.field;
          setErrors((current) => ({ ...current, [field]: error.message }));
        }
      }
      const issues = validationIssues(error);
      if (issues.length > 0) {
        const mapped: Record<string, string> = {};
        for (const issue of issues) {
          const key = String(issue.path[0] ?? "form");
          if (!mapped[key]) mapped[key] = issue.message;
        }
        setErrors((current) => ({ ...current, ...mapped }));
      }
      setGeneralError(errorMessage(error));
    },
  });

  const scanCompose = useMutation({
    mutationFn: (override?: Partial<ComposeFormState>) => {
      const source = { ...compose, ...override };
      return apiJson<ScanComposeResponse>(
        "/api/apps/scan-compose",
        "POST",
        source.inputMode === "repo"
          ? {
              repoUrl: source.repoUrl.trim(),
              branch: source.branch.trim(),
              composePath: source.composePath.trim() || undefined,
              repoToken: source.repoToken || undefined,
            }
          : { compose: source.composeText },
      );
    },
    onSuccess: (result) => {
      setCompose((current) => composeStateFromScan(result, current));
      setComposeError(null);
    },
    onError: (error) => setComposeError(errorMessage(error)),
  });

  const updateCompose = (patch: Partial<ComposeFormState>) => {
    setCompose((current) => ({ ...current, ...patch }));
  };

  const useComposeFromGithub = () => {
    const repoUrl = form.repoUrl.trim();
    const branch = form.branch.trim() || "main";
    const repoToken = form.repoToken;
    update("sourceType", "compose");
    setCompose((current) => ({
      ...current,
      inputMode: "repo",
      repoUrl,
      branch,
      composePath: "",
      repoToken,
      scan: null,
    }));
    if (repoUrl) {
      scanCompose.mutate({
        inputMode: "repo",
        repoUrl,
        branch,
        composePath: "",
        repoToken,
        scan: null,
      });
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setGeneralError(null);
    setErrors({});

    if (form.sourceType === "compose") {
      const services = Object.entries(compose.services).map(([name, service]) => ({
        name,
        expose: service.expose,
        subdomains: service.subdomains.map((value) => value.trim()).filter(Boolean),
        internalPort: Number(service.internalPort),
        healthPath: service.healthPath.trim() || "/",
        envVars: service.envRows
          .filter((row) => row.key.trim())
          .map((row) => ({ key: row.key.trim(), value: row.value, secret: row.secret })),
      }));
      const exposed = services.filter((service) => service.expose);
      const primary = exposed[0]?.subdomains[0];
      if (services.length === 0) {
        setGeneralError("Scan the compose file and configure at least one service.");
        return;
      }
      if (!primary) {
        setGeneralError("Publish at least one service and give it a subdomain.");
        return;
      }
      const payload = {
        name: form.name.trim(),
        subdomain: primary,
        domain: form.domain.trim() || undefined,
        sourceType: "compose" as const,
        composeFile: compose.composeText || undefined,
        composePath:
          compose.inputMode === "repo" ? compose.composePath.trim() || undefined : undefined,
        repoUrl: compose.inputMode === "repo" ? compose.repoUrl.trim() || undefined : undefined,
        branch: compose.inputMode === "repo" ? compose.branch.trim() || undefined : undefined,
        repoToken:
          compose.inputMode === "repo" && compose.repoToken ? compose.repoToken : undefined,
        deployTarget: compose.deployTarget,
        composeServices: services,
        envVars: compose.projectEnv
          .filter((row) => row.key.trim())
          .map((row) => ({ key: row.key.trim(), value: row.value, secret: row.secret })),
        internalPort: exposed[0]?.internalPort,
        healthPath: "/",
        volumes: [],
      };
      const parsed = createAppSchema.safeParse(payload);
      if (!parsed.success) {
        const mapped: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const key = String(issue.path[0] ?? "form");
          if (!mapped[key]) mapped[key] = issue.message;
        }
        setErrors(mapped);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      create.mutate(parsed.data);
      return;
    }

    const payload = {
      name: form.name.trim(),
      subdomain: form.subdomain.trim(),
      domain: form.domain.trim() || undefined,
      sourceType: form.sourceType,
      imageRef: form.sourceType === "image" ? form.imageRef.trim() || undefined : undefined,
      registryUsername:
        form.sourceType === "image" ? form.registryUsername.trim() || undefined : undefined,
      registryPassword:
        form.sourceType === "image" && form.registryPassword
          ? form.registryPassword
          : undefined,
      repoUrl: form.sourceType === "github" ? form.repoUrl.trim() || undefined : undefined,
      branch: form.sourceType === "github" ? form.branch.trim() || undefined : undefined,
      dockerfilePath:
        form.sourceType === "github" ? form.dockerfilePath.trim() || undefined : undefined,
      buildContext:
        form.sourceType === "github" ? form.buildContext.trim() || undefined : undefined,
      repoToken:
        form.sourceType === "github" && form.repoToken ? form.repoToken : undefined,
      internalPort: Number(form.internalPort),
      healthPath: form.healthPath.trim() || "/",
      envVars: form.envVars
        .filter((row) => row.key.trim())
        .map((row) => ({ key: row.key.trim(), value: row.value, secret: row.secret })),
      volumes: form.volumes
        .filter((row) => row.containerPath.trim() && row.volumeName.trim())
        .map((row) => ({
          containerPath: row.containerPath.trim(),
          volumeName: row.volumeName.trim(),
        })),
      cicdEnabled: form.sourceType === "github" ? form.cicdEnabled : false,
    };

    const parsed = createAppSchema.safeParse(payload);
    if (!parsed.success) {
      const mapped: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!mapped[key]) mapped[key] = issue.message;
      }
      setErrors(mapped);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    create.mutate(parsed.data);
  };

  const slugCheck = form.name ? validateSlug(form.name) : null;
  const subdomainCheck = form.subdomain ? validateSubdomain(form.subdomain) : null;
  const composePrimary = Object.values(compose.services)
    .filter((service) => service.expose)
    .flatMap((service) => service.subdomains)
    .find((subdomain) => subdomain.trim());
  const effectiveDomain = form.domain.trim() || baseDomain;
  const previewSubdomain =
    form.sourceType === "compose"
      ? composePrimary || "your-app"
      : form.subdomain || "my-app";
  const previewUrl = `${effectiveDomain === "localhost" ? "http" : "https"}://${previewSubdomain}.${effectiveDomain}`;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to applications
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">New application</h1>
        <p className="mt-1 text-sm text-muted">
          Launchpad builds or pulls the image, starts a container on the shared network and waits
          for it to answer its health check.
        </p>
      </div>

      {generalError ? (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {generalError}
        </div>
      ) : null}

      <form onSubmit={submit} className="space-y-5">
        <Panel
          title="Basics"
          description={
            form.sourceType === "compose"
              ? "The project name is permanent. Every service gets its own hostnames."
              : "The name and subdomain are permanent identifiers."
          }
        >
          <div className="mb-4 grid grid-cols-1 gap-2 rounded-lg border border-edge bg-panel-2 p-1 sm:grid-cols-3">
            {(
              [
                { value: "image", label: "Docker image", icon: ImageIcon },
                { value: "github", label: "GitHub repository", icon: GitBranch },
                { value: "compose", label: "Compose project", icon: Layers },
              ] as const
            ).map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => update("sourceType", value)}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md py-2 text-sm font-medium transition-colors",
                  form.sourceType === value
                    ? "bg-panel text-ink shadow-sm"
                    : "text-muted hover:text-ink",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          <div className={cn("grid gap-4", form.sourceType !== "compose" && "sm:grid-cols-2")}>
            <Field
              label="Name"
              hint="Lowercase slug, unique in the panel."
              error={errors.name ?? (slugCheck && !slugCheck.ok ? slugCheck.reason : undefined)}
            >
              <input
                className={inputClass}
                value={form.name}
                onChange={(event) => {
                  const value = event.target.value.toLowerCase();
                  update("name", value);
                  if (!subdomainTouched && form.sourceType !== "compose") {
                    update("subdomain", value);
                  }
                }}
                placeholder="my-blog"
                spellCheck={false}
                autoFocus
              />
            </Field>
            {form.sourceType !== "compose" ? (
              <Field
                label="Subdomain"
                hint={
                  availability?.subdomainAvailable === false
                    ? undefined
                    : "A DNS label: lowercase letters, numbers and hyphens."
                }
                error={
                  errors.subdomain ??
                  (subdomainCheck && !subdomainCheck.ok
                    ? subdomainCheck.reason
                    : availability?.subdomainAvailable === false
                      ? "This subdomain is already in use."
                      : undefined)
                }
              >
                <div className="flex items-center gap-2">
                  <input
                    className={inputClass}
                    value={form.subdomain}
                    onChange={(event) => {
                      setSubdomainTouched(true);
                      update("subdomain", event.target.value.toLowerCase());
                    }}
                    placeholder="blog"
                    spellCheck={false}
                  />
                  {availability?.subdomainAvailable && subdomainCheck?.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                  ) : availability?.subdomainAvailable === false ? (
                    <XCircle className="h-4 w-4 shrink-0 text-danger" />
                  ) : null}
                </div>
              </Field>
            ) : null}
          </div>

          <div className="mt-4">
            <Field
              label="Project domain (optional)"
              hint={`Empty uses the panel default (${baseDomain}). Use localhost for local test URLs.`}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <div className="min-w-0 flex-1">
                  <input
                    className={inputClass}
                    value={form.domain}
                    onChange={(event) => update("domain", event.target.value.toLowerCase())}
                    placeholder={baseDomain}
                    spellCheck={false}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="shrink-0"
                  onClick={() => update("domain", "localhost")}
                >
                  Use localhost
                </Button>
                {form.domain ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => update("domain", "")}
                  >
                    Use default
                  </Button>
                ) : null}
              </div>
            </Field>
          </div>

          {form.sourceType === "compose" ? (
            <>
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-edge bg-panel-2 px-3 py-2.5 text-sm">
                <Globe2 className="h-4 w-4 text-muted" />
                <span className="text-muted">Primary URL</span>
                <span className="truncate font-mono text-xs text-ink">{previewUrl}</span>
              </div>
              <p className="mt-2 text-xs text-muted">
                Publish services and assign their subdomains in the compose section below.
              </p>
            </>
          ) : (
            <>
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-edge bg-panel-2 px-3 py-2.5 text-sm">
                <Globe2 className="h-4 w-4 text-muted" />
                <span className="text-muted">Live URL</span>
                <span className="truncate font-mono text-xs text-ink">{previewUrl}</span>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field
                  label="Internal port"
                  hint="The port your app listens on inside the container."
                  error={errors.internalPort}
                >
                  <input
                    className={inputClass}
                    type="number"
                    min={1}
                    max={65535}
                    value={form.internalPort}
                    onChange={(event) => update("internalPort", event.target.value)}
                  />
                </Field>
                <Field
                  label="Health check path"
                  hint="Must return 2xx or 3xx before traffic is routed."
                  error={errors.healthPath}
                >
                  <input
                    className={inputClass}
                    value={form.healthPath}
                    onChange={(event) => update("healthPath", event.target.value)}
                    placeholder="/"
                    spellCheck={false}
                  />
                </Field>
              </div>
            </>
          )}

          {availability?.nameAvailable === false ? (
            <p className="mt-3 text-xs text-danger">The name “{form.name}” is already in use.</p>
          ) : null}
        </Panel>

        {form.sourceType === "compose" ? (
          <ComposeBuilder
            state={compose}
            onChange={updateCompose}
            baseDomain={baseDomain}
            scanning={scanCompose.isPending}
            scanError={composeError}
            onScan={() => scanCompose.mutate()}
          />
        ) : (
          <>
        <Panel title="Source" description="Pull a prebuilt image or build from a GitHub repository.">
          {form.sourceType === "image" ? (
            <div className="space-y-4">
              <Field
                label="Image reference"
                hint='e.g. "nginx:1.27", "ghcr.io/acme/api:latest"'
                error={errors.imageRef}
              >
                <input
                  className={inputClass}
                  value={form.imageRef}
                  onChange={(event) => update("imageRef", event.target.value)}
                  placeholder="nginx:latest"
                  spellCheck={false}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Registry username (optional)">
                  <input
                    className={inputClass}
                    value={form.registryUsername}
                    onChange={(event) => update("registryUsername", event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
                <Field label="Registry password / token (optional)">
                  <input
                    className={inputClass}
                    type="password"
                    value={form.registryPassword}
                    onChange={(event) => update("registryPassword", event.target.value)}
                    autoComplete="new-password"
                  />
                </Field>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <Field
                label="Repository URL"
                hint="HTTPS URL accepted; tokens authenticate private repositories."
                error={errors.repoUrl}
              >
                <input
                  className={inputClass}
                  value={form.repoUrl}
                  onChange={(event) => update("repoUrl", event.target.value)}
                  placeholder="https://github.com/you/repo.git"
                  spellCheck={false}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Branch" error={errors.branch}>
                  <input
                    className={inputClass}
                    value={form.branch}
                    onChange={(event) => update("branch", event.target.value)}
                    spellCheck={false}
                  />
                </Field>
                <Field label="Dockerfile path" error={errors.dockerfilePath}>
                  <input
                    className={inputClass}
                    value={form.dockerfilePath}
                    onChange={(event) => update("dockerfilePath", event.target.value)}
                    placeholder="Dockerfile"
                    spellCheck={false}
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Build context"
                  hint='Relative to the repository root; use "." for the root.'
                  error={errors.buildContext}
                >
                  <input
                    className={inputClass}
                    value={form.buildContext}
                    onChange={(event) => update("buildContext", event.target.value)}
                    spellCheck={false}
                  />
                </Field>
                <Field
                  label="Access token (optional)"
                  hint="For private repositories. Stored encrypted."
                >
                  <input
                    className={inputClass}
                    type="password"
                    value={form.repoToken}
                    onChange={(event) => update("repoToken", event.target.value)}
                    autoComplete="off"
                  />
                </Field>
              </div>

              <div className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-3">
                <p className="text-xs font-medium text-ink">
                  Does this repository contain a docker-compose file?
                </p>
                <p className="mt-1 text-xs text-muted">
                  Scan it and publish one or more subdomains per service. The repository is used as
                  the build source and GitHub pushes redeploy the stack.
                </p>
                <Button type="button" size="sm" className="mt-3" onClick={useComposeFromGithub}>
                  <Layers className="h-3.5 w-3.5" />
                  Use docker-compose
                </Button>
              </div>
            </div>
          )}
        </Panel>

        <Panel
          title="Environment variables"
          description="The value is encrypted at rest. Mark sensitive values as secret."
        >
          <EnvEditor rows={form.envVars} onChange={(rows) => update("envVars", rows)} />
          {errors.envVars ? <p className="mt-2 text-xs text-danger">{errors.envVars}</p> : null}
        </Panel>

        <Panel
          title="Persistent volumes"
          description="Named Docker volumes are created automatically."
        >
          <VolumesEditor rows={form.volumes} onChange={(rows) => update("volumes", rows)} />
          {errors.volumes ? <p className="mt-2 text-xs text-danger">{errors.volumes}</p> : null}
        </Panel>

        <Panel
          title="CI/CD with GitHub Actions"
          description={
            form.sourceType === "github"
              ? "Push to GHCR from Actions, then let the workflow call Launchpad's deploy webhook."
              : "Available only for GitHub repository sources."
          }
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Build and deploy on GitHub Actions</p>
              <p className="mt-1 text-xs text-muted">
                {form.sourceType === "github"
                  ? "Launchpad generates a workflow file for this app. You can commit it automatically from the app page."
                  : "Switch the source to a GitHub repository to enable CI/CD."}
              </p>
            </div>
            <Toggle
              label="Enable CI/CD"
              checked={form.sourceType === "github" && form.cicdEnabled}
              disabled={form.sourceType !== "github"}
              onChange={(checked) => update("cicdEnabled", checked)}
            />
          </div>
          {form.sourceType === "github" && form.cicdEnabled ? (
            <p className="mt-4 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-muted">
              The initial deployment still builds from source so the app comes up immediately.
              After setup, pushes are built in Actions and deployed through the webhook.
            </p>
          ) : null}
        </Panel>

          </>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-edge pt-4">
          <Link
            to="/"
            className="inline-flex h-9 items-center rounded-lg px-4 text-sm text-muted transition hover:bg-panel-2 hover:text-ink"
          >
            Cancel
          </Link>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            <Rocket className="h-4 w-4" />
            {create.isPending ? "Deploying…" : "Create and deploy"}
          </Button>
        </div>
      </form>
    </div>
  );
}
