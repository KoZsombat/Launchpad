import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { SettingsView } from "@launchpad/shared";
import { apiJson, errorMessage } from "../lib/api";
import { api } from "../lib/api";
import { Button, Field, inputClass, Panel, Spinner } from "../components/ui";
import { authClient } from "../lib/auth";

interface SettingsFormState {
  baseDomain: string;
  githubToken: string;
  ghcrUsername: string;
  ghcrToken: string;
  sshHost: string;
  sshPort: string;
  sshUsername: string;
  sshAuthMethod: "password" | "key";
  sshPassword: string;
  sshPrivateKey: string;
  uploadLimitMb: string;
}

const emptyForm: SettingsFormState = {
  baseDomain: "",
  githubToken: "",
  ghcrUsername: "",
  ghcrToken: "",
  sshHost: "",
  sshPort: "22",
  sshUsername: "",
  sshAuthMethod: "password",
  sshPassword: "",
  sshPrivateKey: "",
  uploadLimitMb: "64",
};

export function SettingsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<{ settings: SettingsView }>("/api/settings"),
  });
  const settings = settingsQuery.data?.settings;
  const [form, setForm] = useState<SettingsFormState>(emptyForm);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<{ type: "ok" | "error"; message: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<{ type: "ok" | "error"; message: string } | null>(
    null,
  );

  useEffect(() => {
    if (!settings || loaded) return;
    setForm({
      baseDomain: settings.baseDomain,
      githubToken: "",
      ghcrUsername: settings.ghcrUsername ?? "",
      ghcrToken: "",
      sshHost: settings.sshHost ?? "",
      sshPort: settings.sshPort ? String(settings.sshPort) : "22",
      sshUsername: settings.sshUsername ?? "",
      sshAuthMethod: settings.sshAuthMethod ?? "password",
      sshPassword: "",
      sshPrivateKey: "",
      uploadLimitMb: String(settings.uploadLimitMb),
    });
    setLoaded(true);
  }, [settings, loaded]);

  const save = useMutation({
    mutationFn: () =>
      apiJson<{ settings: SettingsView }>("/api/settings", "PUT", {
        baseDomain: form.baseDomain || undefined,
        ...(form.githubToken ? { githubToken: form.githubToken } : {}),
        ghcrUsername: form.ghcrUsername || null,
        ...(form.ghcrToken ? { ghcrToken: form.ghcrToken } : {}),
        sshHost: form.sshHost || null,
        sshPort: form.sshPort ? Number(form.sshPort) : null,
        sshUsername: form.sshUsername || null,
        sshAuthMethod: form.sshAuthMethod,
        uploadLimitMb: Number(form.uploadLimitMb) || undefined,
        ...(form.sshPassword ? { sshPassword: form.sshPassword } : {}),
        ...(form.sshPrivateKey ? { sshPrivateKey: form.sshPrivateKey } : {}),
      }),
    onSuccess: () => {
      setStatus({ type: "ok", message: "Settings saved." });
      setForm((current) => ({
        ...current,
        githubToken: "",
        ghcrToken: "",
        sshPassword: "",
        sshPrivateKey: "",
      }));
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error) => setStatus({ type: "error", message: errorMessage(error) }),
  });

  const changePassword = useMutation({
    mutationFn: () =>
      apiJson<{ ok: boolean }>("/api/settings/password", "POST", {
        currentPassword,
        newPassword,
      }),
    onSuccess: async () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await authClient.signOut().catch(() => undefined);
      navigate("/login", {
        replace: true,
        state: { notice: "Password changed. Sign in with your new password." },
      });
    },
    onError: (error) => setPasswordStatus({ type: "error", message: errorMessage(error) }),
  });

  const submitSettings = (event: FormEvent) => {
    event.preventDefault();
    setStatus(null);
    save.mutate();
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    setPasswordStatus(null);
    if (newPassword !== confirmPassword) {
      setPasswordStatus({ type: "error", message: "New passwords do not match." });
      return;
    }
    changePassword.mutate();
  };

  if (settingsQuery.isPending || !loaded) {
    return (
      <div className="mx-auto max-w-3xl">
        <Spinner label="Loading settings…" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Panel URL: <span className="font-mono text-xs">{settings?.panelUrl}</span>
        </p>
      </header>

      <form onSubmit={submitSettings} className="space-y-6">
        <Panel title="Routing" description="Used for new subdomains and Traefik host rules.">
          <Field
            label="Base domain"
            hint="Default for new projects. Each project can override it, including localhost for tests. Changing this only affects future deployments."
          >
            <input
              className={inputClass}
              value={form.baseDomain}
              onChange={(event) =>
                setForm((current) => ({ ...current, baseDomain: event.target.value }))
              }
              placeholder="example.com"
              spellCheck={false}
            />
          </Field>
        </Panel>

        <Panel
          title="GitHub"
          description="Personal access token with repo scope, used to commit the generated workflow file."
        >
          <Field
            label="GitHub token"
            hint={
              settings?.githubTokenSet
                ? "A token is configured. Leave blank to keep it."
                : "No token configured. The workflow YAML is shown for manual copying."
            }
          >
            <input
              className={inputClass}
              type="password"
              value={form.githubToken}
              onChange={(event) =>
                setForm((current) => ({ ...current, githubToken: event.target.value }))
              }
              placeholder={settings?.githubTokenSet ? "•••••••• (unchanged)" : "ghp_…"}
              autoComplete="off"
            />
          </Field>
        </Panel>

        <Panel
          title="GHCR"
          description="Used to pull private images pushed by GitHub Actions. A classic PAT with read:packages is enough."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Username">
              <input
                className={inputClass}
                value={form.ghcrUsername}
                onChange={(event) =>
                  setForm((current) => ({ ...current, ghcrUsername: event.target.value }))
                }
                placeholder="github-user"
                autoComplete="off"
              />
            </Field>
            <Field
              label="Token"
              hint={settings?.ghcrTokenSet ? "Configured. Leave blank to keep it." : undefined}
            >
              <input
                className={inputClass}
                type="password"
                value={form.ghcrToken}
                onChange={(event) =>
                  setForm((current) => ({ ...current, ghcrToken: event.target.value }))
                }
                placeholder={settings?.ghcrTokenSet ? "•••••••• (unchanged)" : "ghp_…"}
                autoComplete="off"
              />
            </Field>
          </div>
        </Panel>

        <Panel
          title="Host uploads"
          description="Maximum size of a single file copied from your computer onto the host that runs an app, from the app terminal."
        >
          <Field
            label="Max upload size (MB)"
            hint="Uploads are streamed over SFTP straight to the host, so the file never sits in the panel's memory. Large files need free space at the destination."
          >
            <input
              className={inputClass}
              type="number"
              min={1}
              max={4096}
              value={form.uploadLimitMb}
              onChange={(event) =>
                setForm((current) => ({ ...current, uploadLimitMb: event.target.value }))
              }
            />
          </Field>
        </Panel>

        <Panel
          title="Remote hosts & web SSH terminal (optional)"
          description="Local projects use the Docker socket and need no SSH. Configure this only for projects deployed to a separate host, or to use the browser terminal. Use host.docker.internal or the VM IP."
        >
          <p className="mb-4 rounded-lg border border-edge bg-panel-2 px-3 py-2 text-xs text-muted">
            This is only required when projects run on a separate machine. Projects with the
            local target never open an SSH connection.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Host" className="sm:col-span-2">
              <input
                className={inputClass}
                value={form.sshHost}
                onChange={(event) =>
                  setForm((current) => ({ ...current, sshHost: event.target.value }))
                }
                placeholder="host.docker.internal"
                spellCheck={false}
              />
            </Field>
            <Field label="Port">
              <input
                className={inputClass}
                type="number"
                min={1}
                max={65535}
                value={form.sshPort}
                onChange={(event) =>
                  setForm((current) => ({ ...current, sshPort: event.target.value }))
                }
              />
            </Field>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Username">
              <input
                className={inputClass}
                value={form.sshUsername}
                onChange={(event) =>
                  setForm((current) => ({ ...current, sshUsername: event.target.value }))
                }
                placeholder="debian"
                spellCheck={false}
              />
            </Field>
            <Field label="Authentication">
              <select
                className={inputClass}
                value={form.sshAuthMethod}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    sshAuthMethod: event.target.value === "key" ? "key" : "password",
                  }))
                }
              >
                <option value="password">Password</option>
                <option value="key">Private key</option>
              </select>
            </Field>
          </div>

          {form.sshAuthMethod === "password" ? (
            <div className="mt-4">
              <Field
                label="Password"
                hint={
                  settings?.sshPasswordSet ? "A password is configured. Leave blank to keep it." : undefined
                }
              >
                <input
                  className={inputClass}
                  type="password"
                  value={form.sshPassword}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, sshPassword: event.target.value }))
                  }
                  placeholder={settings?.sshPasswordSet ? "•••••••• (unchanged)" : undefined}
                  autoComplete="new-password"
                />
              </Field>
            </div>
          ) : (
            <div className="mt-4">
              <Field
                label="Private key"
                hint={
                  settings?.sshPrivateKeySet
                    ? "A key is configured. Leave blank to keep it."
                    : "Paste an unencrypted OpenSSH private key."
                }
              >
                <textarea
                  className={`${inputClass} min-h-32 font-mono text-xs`}
                  value={form.sshPrivateKey}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, sshPrivateKey: event.target.value }))
                  }
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  spellCheck={false}
                />
              </Field>
            </div>
          )}
        </Panel>

        {status ? (
          <div
            className={
              status.type === "ok"
                ? "rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success"
                : "rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
            }
          >
            {status.message}
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </form>

      <form onSubmit={submitPassword}>
        <Panel title="Change password" description="Changes the password for the single admin user.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Current password">
              <input
                className={inputClass}
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            <Field label="New password">
              <input
                className={inputClass}
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </Field>
            <Field label="Confirm new password">
              <input
                className={inputClass}
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </Field>
          </div>

          {passwordStatus ? (
            <div
              className={
                passwordStatus.type === "ok"
                  ? "mt-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success"
                  : "mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
              }
            >
              {passwordStatus.message}
            </div>
          ) : null}

          <div className="mt-4 flex justify-end">
            <Button type="submit" disabled={changePassword.isPending}>
              {changePassword.isPending ? "Updating…" : "Update password"}
            </Button>
          </div>
        </Panel>
      </form>
    </div>
  );
}
