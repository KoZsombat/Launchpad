# Launchpad

Self-hosted deploy panel for a Proxmox VM running Docker. Fill in a form, Launchpad pulls or builds an image, starts a container on the shared `web` network, waits for its health check, and Traefik publishes it at `<subdomain>.<BASE_DOMAIN>` through a Cloudflare Tunnel.

```
Internet ── HTTPS ──> Cloudflare (wildcard DNS + Access)
                            │
                            ▼ Cloudflare Tunnel
                    cloudflared (container)
                            │ http://traefik:80
                            ▼
                       traefik (container)
                        │   Docker labels
          ┌─────────────┴──────────────┐
          ▼                            ▼
   launchpad panel              app containers
   panel.example.com            blog.example.com, api.example.com, …
```

## ⚠️ Security warning — read first

The panel mounts `/var/run/docker.sock`, which is equivalent to **root on the VM**. Anyone who can use the panel can start privileged containers, mount host paths and read every secret the VM can see.

- **Cloudflare Access in front of `panel.<BASE_DOMAIN>` is mandatory.** Do not expose port 3000 publicly.
- Treat the panel admin password, `ENCRYPTION_KEY`, Docker socket and web SSH terminal with the same care as root SSH access.
- The web terminal opens an SSH session from the panel container to your VM's sshd. It is protected by the panel session and Cloudflare Access, but it is still a shell on the host.

## Repository layout

```
apps/server        Express 5 API, Better Auth, Docker orchestration, SQLite/Drizzle
apps/web           React + Vite dashboard and xterm.js SSH terminal
packages/shared    Zod schemas, shared types, Traefik label builder, deployment state machine
Dockerfile         Single production image (API + built React app)
docker-compose.yml cloudflared + Traefik + launchpad on the external `web` network
.env.example       Required environment variables
```

## Requirements

- Proxmox VE 8+ with a Debian 12 VM (2 vCPU / 2 GB RAM is enough for the panel; app builds need more).
- A domain managed by Cloudflare.
- A Cloudflare Tunnel token.
- Docker Engine + Compose plugin on the VM.

---

## 1. Create the Proxmox VM and install Docker

Create a Debian 12 VM (or use a Proxmox Debian LXC/VM template) with a static LAN IP or DHCP reservation. SSH into it and install Docker:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and back in, then create the shared network once:

```bash
docker network create web
```

If you use the web SSH terminal, make sure `sshd` is enabled and reachable:

```bash
sudo systemctl enable --now ssh
```

## 2. Move the domain to Cloudflare

Add the domain in the Cloudflare dashboard and change the registrar's nameservers to the two Cloudflare nameservers. Wait for the zone to become **Active**.

Keep the DNS records you need (for example the Proxmox host record) and delete conflicting `A`/`AAAA` records for the wildcard once the tunnel is set up.

## 3. Create the Cloudflare Tunnel

1. Cloudflare Zero Trust → **Networks → Tunnels → Create a tunnel**. Choose **Cloudflared**, name it `launchpad`, and copy the token.
2. Add a **Public Hostname**:
   - Subdomain: `*`
   - Domain: `example.com`
   - Path: *(empty)*
   - Service: **HTTP** → `traefik:80`
3. Cloudflare creates the DNS records. If you add them manually, the wildcard must be a proxied `CNAME` named `*` pointing at `<tunnel-id>.cfargotunnel.com`.
4. Put the token in `.env` as `TUNNEL_TOKEN`.

The wildcard hostname is what makes every new app subdomain work. Launchpad never calls the Cloudflare API for app DNS: Traefik labels on each app container are enough.

## 4. Create the Cloudflare Access application for the panel

1. Zero Trust → **Access → Applications → Add an application → Self-hosted**.
2. Application domain: `panel.example.com` (exactly the hostname in `BETTER_AUTH_URL`).
3. Add a policy that allows only your email (one-time PIN or your identity provider). Keep the default **Deny** for everyone else.
4. Optionally set a short session duration.

For the CI/CD webhook, either create a **service token** or bypass only the hook path:

**Option A — service token (recommended)**

1. Zero Trust → Access → **Service Auth → Service Tokens → Create Service Token**. Copy the Client ID and Client Secret (shown once).
2. Open the Access application for `panel.example.com` → Policies → add a policy with action **Service Auth** and include that service token.
3. Add `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` as GitHub repository secrets (see step 7). The generated workflow sends them as headers.

**Option B — bypass the hook path**

1. Zero Trust → Access → Applications → Add a self-hosted application for `panel.example.com` with path `api/hooks` (or `/api/hooks/*`).
2. Add a policy with action **Bypass** for Everyone.
3. GitHub Actions then does not need the two CF headers. The generated workflow still sends them; either add dummy values or remove those two `-H` lines. The per-app webhook secret/HMAC remains the only protection on that path.

## 5. Start the stack

On the VM, clone/copy this repository, then:

```bash
cp .env.example .env
```

Generate the secrets:

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY
```

Edit `.env`:

```dotenv
BASE_DOMAIN=example.com
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=a-long-password
BETTER_AUTH_SECRET=<generated>
BETTER_AUTH_URL=https://panel.example.com
ENCRYPTION_KEY=<generated>
TUNNEL_TOKEN=<from the Cloudflare tunnel>
```

`BETTER_AUTH_URL` must be exactly the public panel origin (including `https://`). Better Auth rejects other origins.

Start the stack:

```bash
docker compose up -d --build
docker compose logs -f launchpad
```

On first start the server runs migrations, creates the single admin user from `ADMIN_EMAIL` / `ADMIN_PASSWORD` if the user table is empty, and starts listening. Sign-up is disabled in Better Auth; the admin is inserted with the same password hasher Better Auth uses for login.

Open `https://panel.example.com`. Cloudflare Access prompts first, then the panel login.

> Changing `ADMIN_EMAIL` / `ADMIN_PASSWORD` later does not modify an existing user. Use **Settings → Change password** instead.

## 6. Deploy a first test app

1. Click **New app**.
2. Name: `demo`, subdomain: `demo`, source: **Docker image**, image `nginx:1.27-alpine`, internal port `80`, health path `/`.
3. Submit. You are redirected to the app page and the deployment log streams live:

```
Pulling image nginx:1.27-alpine
Container ... started; waiting for health.
Health check passed: HTTP 200 ...
Deployment healthy. Traffic is now routed to the new container.
```

4. Open `https://demo.example.com`. The wildcard DNS record and Traefik labels make it live immediately.

How deployments stay up during a redeploy:

- The new container gets the **same** Traefik router/service labels as the old one. Traefik merges the containers into one service with two healthy servers.
- The service has an active health check (the app's health path, every 5 s). Traffic only moves to the new container after it answers.
- Launchpad removes the old container after the new one is healthy. If the new container never becomes healthy, it is removed and the old one keeps serving.

## 7. Set up CI/CD with GitHub Actions

Prerequisites: a GitHub source app and a GitHub token stored in **Settings → GitHub** (classic PAT with `repo` scope; needed to commit the workflow file).

1. In the app page, enable **CI/CD with GitHub Actions**.
2. The CI/CD panel shows:
   - the webhook URL (`https://panel.example.com/api/hooks/deploy/<app-id>`),
   - the per-app webhook secret,
   - the exact GitHub repository secret names,
   - the generated workflow YAML (copy it or commit it with one click).
3. If you have not created the Access service token yet, go back to step 4 and add `LAUNCHPAD_WEBHOOK_SECRET`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` under **GitHub → Settings → Secrets and variables → Actions**.
4. Click **Commit workflow to repo** (or paste the YAML into `.github/workflows/launchpad-deploy.yml` manually).
5. Make the GHCR package pullable by the panel:
   - **Public package:** nothing else to do.
   - **Private package:** store a PAT with `read:packages` under **Settings → GHCR** in Launchpad.
6. Push to the configured branch. The Action:
   - builds with `docker/build-push-action`,
   - pushes `ghcr.io/<owner>/<repo>:<github.sha>` **and** `:latest`,
   - calls the Launchpad webhook with the image tag and commit SHA.
7. Launchpad pulls the image with the GHCR credentials from Settings, starts the container, health-checks it, swaps traffic and removes the old container.

The webhook secret is sent as `X-Launchpad-Secret` and compared in constant time. If the Access service token is not used, create the bypass application from step 4; the webhook secret/HMAC is then the only auth on that path.

### Plain GitHub push webhook (CI/CD off)

For a GitHub-source app with CI/CD **disabled**, Launchpad builds the branch itself. The CI/CD panel shows the push webhook URL.

1. GitHub repo → Settings → Webhooks → Add webhook.
2. Payload URL: `https://panel.example.com/api/hooks/github/<app-id>`.
3. Content type: `application/json`.
4. Secret: the app's webhook secret.
5. Events: **Just the push event**.

Launchpad verifies `X-Hub-Signature-256` (HMAC-SHA256 over the raw body), checks the ref matches the configured branch, and queues a build. The **Redeploy** button does the same build on demand.

## Web SSH terminal (GUI / CLI)

The panel includes a browser terminal that opens an SSH session to the VM.

1. Ensure `sshd` runs on the VM and you know a username plus password or an unencrypted private key.
2. In **Settings → Web SSH terminal** set host `host.docker.internal` (compose maps it to the VM gateway) or the VM's LAN IP, the SSH port (usually 22), the username and the auth method.
3. Use the **GUI / CLI** switch in the sidebar (or `Ctrl + \``) to move between the dashboard and the terminal.

The connection originates inside the panel container on the `web` network. The SSH host key is currently accepted without pinning; restrict the panel's network exposure and rely on Cloudflare Access.

## Local development

```bash
corepack enable            # or install pnpm 12 yourself
pnpm install
docker network create web  # only if you want to deploy from your laptop
cp .env.example .env       # set BETTER_AUTH_URL=http://localhost:3000, COOKIE_SECURE=false
pnpm dev                   # API on :3000, Vite on :5173 with /api proxy
```

`.env` for local development:

```dotenv
BASE_DOMAIN=example.com
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=password123
BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef
BETTER_AUTH_URL=http://localhost:3000
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef
COOKIE_SECURE=false
TUNNEL_TOKEN=unused
```

The API stores its SQLite file and cloned repositories under `apps/server/data/` in development.

### Migrations

Schema changes are made in `apps/server/src/db/schema.ts`, then:

```bash
pnpm db:generate
```

Commit the generated `apps/server/drizzle/` SQL and metadata. The server runs `migrate()` on startup.

### Tests

```bash
pnpm test
pnpm typecheck
pnpm build
```

Tests cover shared Zod validation, subdomain/reserved-name rules, Traefik label generation, the deployment state machine and GitHub webhook HMAC verification.

## Operations notes

- **Data**: `./data/launchpad.db` (SQLite), `./data/repos/<app-id>` (cloned branches). Back up this directory.
- **Secrets at rest**: env values, registry credentials, GitHub/GHCR tokens, the webhook secret and the SSH password/key are encrypted with AES-256-GCM using `ENCRYPTION_KEY`. Changing that key makes existing secrets unreadable.
- **Base domain changes** only affect future deployments; redeploy an app to rewrite its Traefik `Host()` rule.
- **App names and subdomains** are unique and immutable in the UI. Delete and recreate to rename.
- **Volumes**: a volume is created on first deploy. Deleting an app can optionally remove its named volumes.
- **Logs**: deployment logs are stored with the deployment. Container logs are streamed live via SSE and are not persisted.
- **Single user**: Better Auth email/password with sign-up disabled. Login is rate-limited to 10 attempts per 15 minutes per IP.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `404` from Traefik for a new subdomain | Container is running, has `traefik.enable=true`, is on the `web` network, and the wildcard DNS record is proxied. |
| `502` / `504` for an app | Internal port is wrong, or the app is not listening on `0.0.0.0`. Check the container log panel. |
| Deployment fails at “waiting for health” | Health path must return 2xx/3xx on the app's internal port. The panel must be on the `web` network to reach the container IP. Raise `HEALTH_TIMEOUT_MS` for slow starters. |
| GitHub build fails | The panel image includes `git`/`openssh-client`; private repos need a token. Dockerfile and build context must resolve inside the repository. |
| GHCR pull `unauthorized` | Add a `read:packages` token under Settings → GHCR, or make the package public. |
| Better Auth “Invalid origin” | `BETTER_AUTH_URL` must exactly match the browser origin, e.g. `https://panel.example.com`. |
| Webhook returns `401` | Wrong per-app secret, or Cloudflare Access blocked the request before it reached the panel. |
| SSH terminal says “not configured” | Fill in Settings → Web SSH terminal, and verify the panel container can reach the VM's sshd. |
| SSE log stream stalls behind a proxy | Responses set `X-Accel-Buffering: no`; ensure no additional buffering proxy is in front of Traefik. |
