import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Layers, Save, ScanLine, ServerCog } from "lucide-react";
import type { PublicApp, ScanComposeResponse } from "@launchpad/shared";
import { apiJson, errorMessage } from "../lib/api";
import { EnvEditor, type EnvRowState } from "./EnvEditor";
import { SubdomainsEditor } from "./SubdomainsEditor";
import { Button, Field, Panel, Toggle, cn, inputClass } from "./ui";
import {
  composeStateFromScan,
  type ComposeFormState,
  type ComposeServiceFormState,
} from "./ComposeBuilder";

export interface ComposeConfigUpdate {
  domain?: string | null;
  deployTarget: "local" | "remote";
  composeServices: {
    name: string;
    expose: boolean;
    subdomains: string[];
    internalPort: number;
    healthPath: string;
    envVars: { key: string; value?: string; secret: boolean }[];
  }[];
  envVars: { key: string; value?: string; secret: boolean }[];
  composeFile?: string;
  repoUrl?: string;
  branch?: string;
  composePath?: string;
  repoToken?: string;
}

function envRowsFromPublic(
  entries: PublicApp["envVars"],
): EnvRowState[] {
  return entries.map((entry) => ({
    id: crypto.randomUUID(),
    key: entry.key,
    value: entry.secret ? "" : entry.value ?? "",
    secret: entry.secret,
    hasValue: entry.hasValue,
  }));
}

export function ComposeConfigPanel({
  app,
  saving,
  onSave,
}: {
  app: PublicApp;
  saving: boolean;
  onSave: (update: ComposeConfigUpdate) => void;
}) {
  const initialServices: Record<string, ComposeServiceFormState> = Object.fromEntries(
    app.composeServices.map((service) => [
      service.name,
      {
        expose: service.expose,
        subdomains: [...service.subdomains],
        internalPort: String(service.internalPort),
        healthPath: service.healthPath,
        envRows: envRowsFromPublic(service.envVars),
      },
    ]),
  );
  const initialCompose: ComposeFormState = {
    inputMode: app.repoUrl ? "repo" : "paste",
    composeText: app.composeFile ?? "",
    repoUrl: app.repoUrl ?? "",
    branch: app.branch ?? "main",
    composePath: app.composePath ?? "",
    repoToken: "",
    deployTarget: app.deployTarget,
    projectEnv: envRowsFromPublic(app.envVars),
    services: initialServices,
    scan: null,
  };

  const [state, setState] = useState(initialCompose);
  const [domain, setDomain] = useState(app.domain ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  const [rescanError, setRescanError] = useState<string | null>(null);

  const rescan = useMutation({
    mutationFn: () =>
      apiJson<ScanComposeResponse>(
        "/api/apps/scan-compose",
        "POST",
        state.inputMode === "repo"
          ? {
              repoUrl: state.repoUrl.trim(),
              branch: state.branch.trim(),
              composePath: state.composePath.trim() || undefined,
              repoToken: state.repoToken || undefined,
            }
          : { compose: state.composeText },
      ),
    onSuccess: (result) => {
      setState((current) => composeStateFromScan(result, current));
      setRescanError(null);
      setNotice("Compose file scanned. Review the services before saving.");
    },
    onError: (error) => setRescanError(errorMessage(error)),
  });

  const updateService = (name: string, patch: Partial<ComposeServiceFormState>) => {
    const current = state.services[name];
    if (!current) return;
    setState((currentState) => ({
      ...currentState,
      services: { ...currentState.services, [name]: { ...current, ...patch } },
    }));
  };

  const submit = () => {
    const services = Object.entries(state.services).map(([name, service]) => ({
      name,
      expose: service.expose,
      subdomains: service.subdomains.map((value) => value.trim()).filter(Boolean),
      internalPort: Number(service.internalPort),
      healthPath: service.healthPath.trim() || "/",
      envVars: service.envRows
        .filter((row) => row.key.trim())
        .map((row) => ({
          key: row.key.trim(),
          secret: row.secret,
          ...(row.secret && row.value === "" && row.hasValue ? {} : { value: row.value }),
        })),
    }));
    const update: ComposeConfigUpdate = {
      domain: domain.trim() || null,
      deployTarget: state.deployTarget,
      composeServices: services,
      envVars: state.projectEnv
        .filter((row) => row.key.trim())
        .map((row) => ({
          key: row.key.trim(),
          secret: row.secret,
          ...(row.secret && row.value === "" && row.hasValue ? {} : { value: row.value }),
        })),
    };
    if (state.inputMode === "repo") {
      update.repoUrl = state.repoUrl.trim();
      update.branch = state.branch.trim();
      update.composePath = state.composePath.trim() || undefined;
      if (state.repoToken) update.repoToken = state.repoToken;
    } else {
      update.composeFile = state.composeText;
    }
    onSave(update);
  };

  return (
    <div className="space-y-5">
      {notice ? (
        <div className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-accent">
          {notice}
        </div>
      ) : null}
      {rescanError ? (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {rescanError}
        </div>
      ) : null}

      <Panel
        title={
          <span className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Compose source
          </span>
        }
        description="The compose file is the source of truth. Saving configuration queues a new deployment."
        actions={
          <>
            <Button
              type="button"
              size="sm"
              disabled={rescan.isPending}
              onClick={() => rescan.mutate()}
            >
              <ScanLine className={cn("h-3.5 w-3.5", rescan.isPending && "animate-pulse")} />
              {rescan.isPending ? "Scanning…" : "Rescan"}
            </Button>
            <Button type="button" variant="primary" size="sm" disabled={saving} onClick={submit}>
              <Save className="h-3.5 w-3.5" />
              {saving ? "Saving…" : "Save & redeploy"}
            </Button>
          </>
        }
      >
        {state.inputMode === "repo" ? (
          <div className="space-y-4">
            <Field label="Repository URL">
              <input
                className={inputClass}
                value={state.repoUrl}
                onChange={(event) => setState((current) => ({ ...current, repoUrl: event.target.value }))}
                spellCheck={false}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Branch">
                <input
                  className={inputClass}
                  value={state.branch}
                  onChange={(event) => setState((current) => ({ ...current, branch: event.target.value }))}
                  spellCheck={false}
                />
              </Field>
              <Field label="Compose path" hint="Empty means auto-detect.">
                <input
                  className={inputClass}
                  value={state.composePath}
                  onChange={(event) =>
                    setState((current) => ({ ...current, composePath: event.target.value }))
                  }
                  spellCheck={false}
                />
              </Field>
            </div>
            <Field
              label="Access token"
              hint={app.repoTokenSet ? "Configured. Leave blank to keep it." : "Optional."}
            >
              <input
                className={inputClass}
                type="password"
                value={state.repoToken}
                onChange={(event) =>
                  setState((current) => ({ ...current, repoToken: event.target.value }))
                }
                placeholder={app.repoTokenSet ? "•••••••• (unchanged)" : undefined}
                autoComplete="off"
              />
            </Field>
            <p className="text-xs text-muted">
              The compose file is re-read from the repository on every deployment.
            </p>
          </div>
        ) : (
          <Field
            label="Compose file"
            hint="Edit the YAML and rescan to discover new services before saving."
          >
            <textarea
              className={`${inputClass} min-h-52 font-mono text-xs`}
              value={state.composeText}
              onChange={(event) =>
                setState((current) => ({ ...current, composeText: event.target.value }))
              }
              spellCheck={false}
            />
          </Field>
        )}
      </Panel>

      <Panel
        title="Deployment target"
        description="SSH is only required when the project runs on a separate host."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["local", "This host", "Runs through the panel's Docker socket."],
              ["remote", "Separate host", "Uses the SSH settings."],
            ] as const
          ).map(([value, title, hint]) => (
            <button
              key={value}
              type="button"
              onClick={() => setState((current) => ({ ...current, deployTarget: value }))}
              className={cn(
                "flex items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors",
                state.deployTarget === value
                  ? "border-accent/50 bg-accent/5"
                  : "border-edge bg-panel-2/40 hover:border-muted/40",
              )}
            >
              <ServerCog className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
              <span>
                <span className="block text-sm font-medium text-ink">{title}</span>
                <span className="mt-0.5 block text-xs text-muted">{hint}</span>
              </span>
            </button>
          ))}
        </div>
        {state.deployTarget === "remote" ? (
          <p className="mt-3 flex gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Build services are rejected on remote targets, and routing requires Traefik on that
            host.
          </p>
        ) : null}

        <div className="mt-5 border-t border-edge pt-5">
          <Field
            label="Project domain"
            hint={`Empty uses the panel default (${app.defaultDomain}). localhost gives http://<service>.localhost test URLs.`}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <div className="min-w-0 flex-1">
                <input
                  className={inputClass}
                  value={domain}
                  onChange={(event) => setDomain(event.target.value.toLowerCase())}
                  placeholder={app.defaultDomain}
                  spellCheck={false}
                />
              </div>
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                onClick={() => setDomain("localhost")}
              >
                Use localhost
              </Button>
              {domain ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => setDomain("")}
                >
                  Use default
                </Button>
              ) : null}
            </div>
          </Field>
          {domain === "localhost" ? (
            <p className="mt-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-muted">
              Test URLs use <code className="font-mono">http://&lt;service&gt;.localhost</code>. A
              local Traefik on the <code className="font-mono">web</code> network is still needed
              to serve them; browsers resolve <code className="font-mono">*.localhost</code> to
              loopback automatically.
            </p>
          ) : null}
        </div>
      </Panel>

      <Panel
        title="Compose variables"
        description="Values for ${VAR} references in the compose file."
      >
        <EnvEditor
          rows={state.projectEnv}
          onChange={(rows) => setState((current) => ({ ...current, projectEnv: rows }))}
        />
      </Panel>

      <Panel
        title="Services and subdomains"
        description="Publish services and assign one or more hostnames to each."
      >
        <div className="space-y-4">
          {Object.entries(state.services).map(([name, service]) => (
            <div key={name} className="rounded-lg border border-edge bg-panel-2/30 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="font-mono text-sm font-semibold text-ink">{name}</h3>
                <label className="flex items-center gap-2 text-xs text-muted">
                  <Toggle
                    label={`Publish ${name}`}
                    checked={service.expose}
                    onChange={(checked) => updateService(name, { expose: checked })}
                  />
                  Publish
                </label>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Container port">
                  <input
                    className={inputClass}
                    type="number"
                    min={1}
                    max={65535}
                    value={service.internalPort}
                    onChange={(event) =>
                      updateService(name, { internalPort: event.target.value })
                    }
                  />
                </Field>
                <Field
                  label="Health check path"
                  hint="Common: /health, /healthz, /api/health"
                >
                  <input
                    className={inputClass}
                    value={service.healthPath}
                    onChange={(event) => updateService(name, { healthPath: event.target.value })}
                    placeholder="/"
                    spellCheck={false}
                  />
                </Field>
              </div>

              {service.expose ? (
                <div className="mt-4">
                  <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                    Subdomains
                  </h4>
                  <SubdomainsEditor
                    values={service.subdomains}
                    baseDomain={domain.trim() || app.defaultDomain}
                    onChange={(subdomains) => updateService(name, { subdomains })}
                  />
                </div>
              ) : null}

              <div className="mt-4">
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                  Environment overrides
                </h4>
                <EnvEditor
                  rows={service.envRows}
                  onChange={(envRows) => updateService(name, { envRows })}
                />
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
