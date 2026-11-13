import { AlertTriangle, Info, ScanLine, ServerCog } from "lucide-react";
import type { ComposeScanService, ScanComposeResponse, DeployTarget } from "@launchpad/shared";
import { isReservedSubdomain, validateSubdomain } from "@launchpad/shared";
import { EnvEditor, newEnvRow, type EnvRowState } from "./EnvEditor";
import { SubdomainsEditor } from "./SubdomainsEditor";
import { Button, Field, Panel, Toggle, cn, inputClass } from "./ui";

export interface ComposeServiceFormState {
  expose: boolean;
  subdomains: string[];
  internalPort: string;
  healthPath: string;
  envRows: EnvRowState[];
}

export interface ComposeFormState {
  inputMode: "paste" | "repo";
  composeText: string;
  repoUrl: string;
  branch: string;
  composePath: string;
  repoToken: string;
  deployTarget: DeployTarget;
  projectEnv: EnvRowState[];
  services: Record<string, ComposeServiceFormState>;
  scan: ScanComposeResponse | null;
}

export function initialComposeState(): ComposeFormState {
  return {
    inputMode: "paste",
    composeText: "",
    repoUrl: "",
    branch: "main",
    composePath: "",
    repoToken: "",
    deployTarget: "local",
    projectEnv: [],
    services: {},
    scan: null,
  };
}

function secretKey(key: string): boolean {
  return /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|KEY)$/i.test(key);
}

function suggestSubdomain(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  const base = normalized || "app";
  if (isReservedSubdomain(base) || base === "www") return `${base}-app`.slice(0, 63);
  return base;
}

function uniqueSubdomain(base: string, used: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate) || !validateSubdomain(candidate).ok) {
    candidate = `${base.slice(0, 58)}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function literalEnvRows(service: ComposeScanService): EnvRowState[] {
  const rows: EnvRowState[] = [];
  for (const entry of service.environment) {
    if (entry.value !== null && entry.value.includes("$")) continue;
    rows.push({
      ...newEnvRow(),
      key: entry.key,
      value: entry.value ?? "",
      secret: secretKey(entry.key),
    });
  }
  return rows;
}

function mergeEnvRows(existing: EnvRowState[], service: ComposeScanService): EnvRowState[] {
  const rows = [...existing];
  for (const entry of literalEnvRows(service)) {
    if (!rows.some((row) => row.key === entry.key)) rows.push(entry);
  }
  return rows;
}

/** Turns a scan result into editable wizard state, keeping user edits on rescan. */
export function composeStateFromScan(
  response: ScanComposeResponse,
  previous: ComposeFormState,
): ComposeFormState {
  const scan = response.scan;
  const projectKeys = [...new Set([...scan.requiredEnv, ...scan.optionalEnv])];
  const previousEnv = new Map(previous.projectEnv.map((row) => [row.key, row]));
  const projectEnv = projectKeys.map(
    (key) => previousEnv.get(key) ?? { ...newEnvRow(), key, secret: secretKey(key), value: "" },
  );

  const services: Record<string, ComposeServiceFormState> = {};
  const used = new Set<string>();
  for (const service of scan.services) {
    const existing = previous.services[service.name];
    if (existing) {
      for (const subdomain of existing.subdomains) {
        if (subdomain) used.add(subdomain);
      }
    }
  }

  for (const service of scan.services) {
    const existing = previous.services[service.name];
    if (existing) {
      services[service.name] = { ...existing, envRows: mergeEnvRows(existing.envRows, service) };
      continue;
    }
    const expose = service.suggestedExpose;
    const subdomains = expose ? [uniqueSubdomain(suggestSubdomain(service.name), used)] : [];
    services[service.name] = {
      expose,
      subdomains,
      internalPort: String(service.suggestedPort ?? 80),
      healthPath: "/",
      envRows: literalEnvRows(service),
    };
  }

  return {
    ...previous,
    composeText: response.compose,
    composePath: response.composePath ?? previous.composePath,
    projectEnv,
    services,
    scan: response,
  };
}

export function ComposeBuilder({
  state,
  onChange,
  baseDomain,
  scanning,
  scanError,
  onScan,
}: {
  state: ComposeFormState;
  onChange: (patch: Partial<ComposeFormState>) => void;
  baseDomain: string;
  scanning: boolean;
  scanError: string | null;
  onScan: () => void;
}) {
  const scan = state.scan?.scan ?? null;
  const updateService = (name: string, patch: Partial<ComposeServiceFormState>) => {
    const current = state.services[name];
    if (!current) return;
    onChange({ services: { ...state.services, [name]: { ...current, ...patch } } });
  };

  return (
    <div className="space-y-5">
      <Panel
        title="Compose source"
        description="Paste a compose file or scan one from a repository. Launchpad only changes routing and namespacing; your YAML stays the source of truth."
      >
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg border border-edge bg-panel-2 p-1">
          {(
            [
              ["paste", "Paste YAML"],
              ["repo", "From repository"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange({ inputMode: mode })}
              className={cn(
                "rounded-md py-2 text-sm font-medium transition-colors",
                state.inputMode === mode
                  ? "bg-panel text-ink shadow-sm"
                  : "text-muted hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {state.inputMode === "paste" ? (
          <Field
            label="docker-compose.yml"
            hint="The first service port becomes the Traefik backend; you can change it after scanning."
          >
            <textarea
              className={`${inputClass} min-h-52 font-mono text-xs`}
              value={state.composeText}
              onChange={(event) => onChange({ composeText: event.target.value })}
              placeholder={`services:\n  web:\n    image: nginx:1.27\n    ports:\n      - "8080:80"\n`}
              spellCheck={false}
            />
          </Field>
        ) : (
          <div className="space-y-4">
            <Field label="Repository URL" hint="HTTPS or git@ URL; the server clones it to read the compose file.">
              <input
                className={inputClass}
                value={state.repoUrl}
                onChange={(event) => onChange({ repoUrl: event.target.value })}
                placeholder="https://github.com/you/project.git"
                spellCheck={false}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Branch">
                <input
                  className={inputClass}
                  value={state.branch}
                  onChange={(event) => onChange({ branch: event.target.value })}
                  spellCheck={false}
                />
              </Field>
              <Field label="Compose path (optional)" hint="Detected automatically when empty.">
                <input
                  className={inputClass}
                  value={state.composePath}
                  onChange={(event) => onChange({ composePath: event.target.value })}
                  placeholder="docker-compose.yml"
                  spellCheck={false}
                />
              </Field>
            </div>
            <Field label="Access token (optional)" hint="For private repositories.">
              <input
                className={inputClass}
                type="password"
                value={state.repoToken}
                onChange={(event) => onChange({ repoToken: event.target.value })}
                autoComplete="off"
              />
            </Field>
          </div>
        )}

        {scanError ? (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {scanError}
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-3">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={scanning}
            onClick={onScan}
          >
            <ScanLine className={cn("h-3.5 w-3.5", scanning && "animate-pulse")} />
            {scanning ? "Scanning…" : scan ? "Rescan compose" : "Scan compose"}
          </Button>
          {scan ? (
            <span className="text-xs text-muted">
              {scan.services.length} service{scan.services.length === 1 ? "" : "s"} detected
            </span>
          ) : null}
        </div>
      </Panel>

      {scan ? (
        <>
          <Panel
            title="What Launchpad will change"
            description="Review these before deploying. Nothing else in the compose file is rewritten."
          >
            <ul className="space-y-1.5 text-xs text-muted">
              {scan.notes.map((note) => (
                <li key={note} className="flex gap-2">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                  {note}
                </li>
              ))}
            </ul>
            {scan.warnings.length > 0 ? (
              <ul className="mt-3 space-y-1.5 text-xs text-warning">
                {scan.warnings.map((warning) => (
                  <li key={warning} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {warning}
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>

          <Panel
            title="Deployment target"
            description="Local projects run on the panel host through the Docker socket. Choose a separate host only when this project runs elsewhere."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["local", "This host", "No SSH needed."],
                  ["remote", "Separate host", "Uses the SSH settings in Settings."],
                ] as const
              ).map(([value, title, hint]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onChange({ deployTarget: value })}
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
              <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                Remote targets cannot build images on the remote host. Use image-based services, or
                switch to the local target. Routing requires Traefik on that host.
              </p>
            ) : null}
          </Panel>

          {scan.requiredEnv.length + scan.optionalEnv.length > 0 ? (
            <Panel
              title="Compose variables"
              description="Values for ${VAR} references in the compose file. Required variables must be filled in."
            >
              <EnvEditor rows={state.projectEnv} onChange={(rows) => onChange({ projectEnv: rows })} />
              <p className="mt-2 text-xs text-muted">
                Required: {scan.requiredEnv.length > 0 ? scan.requiredEnv.join(", ") : "none"}
                {scan.optionalEnv.length > 0 ? ` · Optional: ${scan.optionalEnv.join(", ")}` : ""}
              </p>
            </Panel>
          ) : null}

          <Panel
            title="Services and subdomains"
            description="Publish a service and give it one or more hostnames. Unpublished services still run for dependencies."
          >
            <div className="space-y-4">
              {scan.services.map((service) => {
                const config = state.services[service.name];
                if (!config) return null;
                return (
                  <div key={service.name} className="rounded-lg border border-edge bg-panel-2/30 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-mono text-sm font-semibold text-ink">{service.name}</h3>
                          <span className="rounded border border-edge bg-panel px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted">
                            {service.build ? `build: ${service.build.context}` : service.image ?? "no image"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          Detected ports:{" "}
                          {service.ports.length > 0
                            ? service.ports
                                .map((port) => `${port.container}/${port.protocol}`)
                                .join(", ")
                            : service.expose.length > 0
                              ? service.expose.join(", ")
                              : "none"}
                          {service.dependsOn.length > 0
                            ? ` · depends on ${service.dependsOn.join(", ")}`
                            : ""}
                        </p>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-muted">
                        <Toggle
                          label={`Publish ${service.name}`}
                          checked={config.expose}
                          onChange={(checked) => updateService(service.name, { expose: checked })}
                        />
                        Publish
                      </label>
                    </div>

                    {service.suggestedKind === "data" ? (
                      <p className="mt-2 text-[11px] text-muted">
                        Detected as a data service. It stays private unless you explicitly publish
                        it; publishing a database usually fails the HTTP health check.
                      </p>
                    ) : null}

                    {service.warnings.length > 0 ? (
                      <ul className="mt-3 space-y-1 text-[11px] text-warning">
                        {service.warnings.map((warning) => (
                          <li key={warning}>• {warning}</li>
                        ))}
                      </ul>
                    ) : null}

                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <Field label="Container port">
                        <input
                          className={inputClass}
                          type="number"
                          min={1}
                          max={65535}
                          value={config.internalPort}
                          onChange={(event) =>
                            updateService(service.name, { internalPort: event.target.value })
                          }
                        />
                      </Field>
                      <Field label="Health check path">
                        <input
                          className={inputClass}
                          value={config.healthPath}
                          onChange={(event) =>
                            updateService(service.name, { healthPath: event.target.value })
                          }
                          placeholder="/"
                          spellCheck={false}
                        />
                      </Field>
                    </div>

                    {config.expose ? (
                      <div className="mt-4">
                        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                          Subdomains
                        </h4>
                        <SubdomainsEditor
                          values={config.subdomains}
                          baseDomain={baseDomain}
                          onChange={(subdomains) => updateService(service.name, { subdomains })}
                        />
                      </div>
                    ) : null}

                    <div className="mt-4">
                      <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                        Environment overrides
                      </h4>
                      <EnvEditor
                        rows={config.envRows}
                        onChange={(envRows) => updateService(service.name, { envRows })}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  );
}
