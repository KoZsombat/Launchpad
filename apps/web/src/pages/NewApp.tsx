import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  GitBranch,
  Globe2,
  Image as ImageIcon,
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

interface FormState {
  name: string;
  subdomain: string;
  sourceType: "image" | "github";
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

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<{ settings: SettingsView }>("/api/settings"),
  });
  const baseDomain = settingsQuery.data?.settings.baseDomain ?? "your-domain.com";

  useEffect(() => {
    if (!form.name || !form.subdomain) {
      setAvailability(null);
      return;
    }
    if (!validateSlug(form.name).ok || !validateSubdomain(form.subdomain).ok) {
      setAvailability(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<AvailabilityResult>(
        `/api/apps/availability?name=${encodeURIComponent(form.name)}&subdomain=${encodeURIComponent(form.subdomain)}`,
        { signal: controller.signal },
      )
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
  }, [form.name, form.subdomain]);

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

    const payload = {
      name: form.name.trim(),
      subdomain: form.subdomain.trim(),
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
        <Panel title="Basics" description="The name and subdomain are permanent identifiers.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" hint="Lowercase slug, unique in the panel." error={errors.name ?? (slugCheck && !slugCheck.ok ? slugCheck.reason : undefined)}>
              <input
                className={inputClass}
                value={form.name}
                onChange={(event) => {
                  const value = event.target.value.toLowerCase();
                  update("name", value);
                  if (!subdomainTouched) update("subdomain", value);
                }}
                placeholder="my-blog"
                spellCheck={false}
                autoFocus
              />
            </Field>
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
          </div>

          <div className="mt-4 flex items-center gap-2 rounded-lg border border-edge bg-panel-2 px-3 py-2.5 text-sm">
            <Globe2 className="h-4 w-4 text-muted" />
            <span className="text-muted">Live URL</span>
            <span className="truncate font-mono text-xs text-ink">
              https://{form.subdomain || "my-app"}.{baseDomain}
            </span>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Internal port" hint="The port your app listens on inside the container." error={errors.internalPort}>
              <input
                className={inputClass}
                type="number"
                min={1}
                max={65535}
                value={form.internalPort}
                onChange={(event) => update("internalPort", event.target.value)}
              />
            </Field>
            <Field label="Health check path" hint="Must return 2xx or 3xx before traffic is routed." error={errors.healthPath}>
              <input
                className={inputClass}
                value={form.healthPath}
                onChange={(event) => update("healthPath", event.target.value)}
                placeholder="/"
                spellCheck={false}
              />
            </Field>
          </div>

          {availability?.nameAvailable === false ? (
            <p className="mt-3 text-xs text-danger">The name “{form.name}” is already in use.</p>
          ) : null}
        </Panel>

        <Panel title="Source" description="Pull a prebuilt image or build from a GitHub repository.">
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg border border-edge bg-panel-2 p-1">
            <button
              type="button"
              onClick={() => update("sourceType", "image")}
              className={cn(
                "flex items-center justify-center gap-2 rounded-md py-2 text-sm font-medium transition-colors",
                form.sourceType === "image"
                  ? "bg-panel text-ink shadow-sm"
                  : "text-muted hover:text-ink",
              )}
            >
              <ImageIcon className="h-4 w-4" />
              Docker image
            </button>
            <button
              type="button"
              onClick={() => update("sourceType", "github")}
              className={cn(
                "flex items-center justify-center gap-2 rounded-md py-2 text-sm font-medium transition-colors",
                form.sourceType === "github"
                  ? "bg-panel text-ink shadow-sm"
                  : "text-muted hover:text-ink",
              )}
            >
              <GitBranch className="h-4 w-4" />
              GitHub repository
            </button>
          </div>

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
