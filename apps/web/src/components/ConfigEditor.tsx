import { useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import type { PublicApp } from "@launchpad/shared";
import {
  EnvEditor,
  VolumesEditor,
  type EnvRowState,
  type VolumeRowState,
} from "./EnvEditor";
import { Button, Field, Panel, inputClass } from "./ui";

export interface AppConfigUpdate {
  domain?: string | null;
  internalPort: number;
  healthPath: string;
  envVars: { key: string; value?: string; secret: boolean }[];
  volumes: { containerPath: string; volumeName: string }[];
  imageRef?: string;
  registryUsername?: string;
  registryPassword?: string;
  repoUrl?: string;
  branch?: string;
  dockerfilePath?: string;
  buildContext?: string;
  repoToken?: string;
}

export function ConfigEditor({
  app,
  saving,
  onSave,
}: {
  app: PublicApp;
  saving: boolean;
  onSave: (update: AppConfigUpdate) => void;
}) {
  const [domain, setDomain] = useState(app.domain ?? "");
  const [internalPort, setInternalPort] = useState(String(app.internalPort));
  const [healthPath, setHealthPath] = useState(app.healthPath);
  const [envRows, setEnvRows] = useState<EnvRowState[]>(
    app.envVars.map((entry) => ({
      id: crypto.randomUUID(),
      key: entry.key,
      value: entry.secret ? "" : entry.value ?? "",
      secret: entry.secret,
      hasValue: entry.hasValue,
    })),
  );
  const [volumeRows, setVolumeRows] = useState<VolumeRowState[]>(
    app.volumes.map((volume) => ({
      id: crypto.randomUUID(),
      containerPath: volume.containerPath,
      volumeName: volume.volumeName,
    })),
  );
  const [imageRef, setImageRef] = useState(app.imageRef ?? "");
  const [registryUsername, setRegistryUsername] = useState(app.registryUsername ?? "");
  const [registryPassword, setRegistryPassword] = useState("");
  const [repoUrl, setRepoUrl] = useState(app.repoUrl ?? "");
  const [branch, setBranch] = useState(app.branch ?? "main");
  const [dockerfilePath, setDockerfilePath] = useState(app.dockerfilePath ?? "Dockerfile");
  const [buildContext, setBuildContext] = useState(app.buildContext ?? ".");
  const [repoToken, setRepoToken] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const update: AppConfigUpdate = {
      domain: domain.trim() || null,
      internalPort: Number(internalPort),
      healthPath: healthPath.trim() || "/",
      envVars: envRows
        .filter((row) => row.key.trim())
        .map((row) => ({
          key: row.key.trim(),
          secret: row.secret,
          ...(row.secret && row.value === "" && row.hasValue ? {} : { value: row.value }),
        })),
      volumes: volumeRows
        .filter((row) => row.containerPath.trim() && row.volumeName.trim())
        .map((row) => ({
          containerPath: row.containerPath.trim(),
          volumeName: row.volumeName.trim(),
        })),
    };
    if (app.sourceType === "image") {
      update.imageRef = imageRef.trim();
      update.registryUsername = registryUsername.trim();
      if (registryPassword) update.registryPassword = registryPassword;
    } else {
      update.repoUrl = repoUrl.trim();
      update.branch = branch.trim();
      update.dockerfilePath = dockerfilePath.trim();
      update.buildContext = buildContext.trim();
      if (repoToken) update.repoToken = repoToken;
    }
    onSave(update);
  };

  return (
    <form onSubmit={submit}>
      <Panel
        title="Configuration"
        description="Saving configuration changes queues a new deployment."
        actions={
          <Button type="submit" variant="primary" size="sm" disabled={saving}>
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Save & redeploy"}
          </Button>
        }
      >
        <div className="grid gap-4">
          <Field
            label="Project domain"
            hint={`Empty uses the panel default (${app.defaultDomain}). Use localhost for local tests.`}
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
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Internal port">
            <input
              className={inputClass}
              type="number"
              min={1}
              max={65535}
              value={internalPort}
              onChange={(event) => setInternalPort(event.target.value)}
            />
          </Field>
          <Field label="Health check path">
            <input
              className={inputClass}
              value={healthPath}
              onChange={(event) => setHealthPath(event.target.value)}
              spellCheck={false}
            />
          </Field>
        </div>

        <details className="mt-5 rounded-lg border border-edge bg-panel-2/50 px-4 py-3">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted">
            Source configuration
          </summary>
          {app.sourceType === "image" ? (
            <div className="mt-4 space-y-4">
              <Field label="Image reference">
                <input
                  className={inputClass}
                  value={imageRef}
                  onChange={(event) => setImageRef(event.target.value)}
                  spellCheck={false}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Registry username">
                  <input
                    className={inputClass}
                    value={registryUsername}
                    onChange={(event) => setRegistryUsername(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
                <Field
                  label="Registry password / token"
                  hint={
                    app.registryPasswordSet
                      ? "Configured. Leave blank to keep it."
                      : "Optional."
                  }
                >
                  <input
                    className={inputClass}
                    type="password"
                    value={registryPassword}
                    onChange={(event) => setRegistryPassword(event.target.value)}
                    autoComplete="new-password"
                    placeholder={app.registryPasswordSet ? "•••••••• (unchanged)" : undefined}
                  />
                </Field>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <Field label="Repository URL">
                <input
                  className={inputClass}
                  value={repoUrl}
                  onChange={(event) => setRepoUrl(event.target.value)}
                  spellCheck={false}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Branch">
                  <input
                    className={inputClass}
                    value={branch}
                    onChange={(event) => setBranch(event.target.value)}
                    spellCheck={false}
                  />
                </Field>
                <Field label="Dockerfile path">
                  <input
                    className={inputClass}
                    value={dockerfilePath}
                    onChange={(event) => setDockerfilePath(event.target.value)}
                    spellCheck={false}
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Build context">
                  <input
                    className={inputClass}
                    value={buildContext}
                    onChange={(event) => setBuildContext(event.target.value)}
                    spellCheck={false}
                  />
                </Field>
                <Field
                  label="Access token"
                  hint={app.repoTokenSet ? "Configured. Leave blank to keep it." : "Optional."}
                >
                  <input
                    className={inputClass}
                    type="password"
                    value={repoToken}
                    onChange={(event) => setRepoToken(event.target.value)}
                    autoComplete="off"
                    placeholder={app.repoTokenSet ? "•••••••• (unchanged)" : undefined}
                  />
                </Field>
              </div>
            </div>
          )}
        </details>

        <div className="mt-5">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
            Environment variables
          </h3>
          <EnvEditor rows={envRows} onChange={setEnvRows} />
        </div>

        <div className="mt-5">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
            Persistent volumes
          </h3>
          <VolumesEditor rows={volumeRows} onChange={setVolumeRows} />
        </div>
      </Panel>
    </form>
  );
}
