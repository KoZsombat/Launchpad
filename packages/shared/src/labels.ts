export interface TraefikLabelInput {
  appId: string;
  /** Single subdomain shorthand. Use `subdomains` for more than one. */
  subdomain?: string;
  subdomains?: string[];
  baseDomain: string;
  port: number;
  healthPath?: string;
  network?: string;
  /** Set for compose services so every service gets its own router and service. */
  serviceName?: string;
}

/** Stable identifier for one app (or one service inside a compose app). */
export function traefikName(appId: string, serviceName?: string): string {
  const base = `lp-${appId}`;
  if (!serviceName) return base;
  const safe = serviceName.replace(/[^A-Za-z0-9_-]/g, "-");
  return `${base}-${safe}`;
}

function normalizeSubdomains(input: TraefikLabelInput): string[] {
  const values = input.subdomains ?? (input.subdomain ? [input.subdomain] : []);
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/**
 * Builds the Docker labels Traefik reads for one app container.
 *
 * Both the old and new containers of an app receive the same router and
 * service names, so Traefik merges them into one service with two servers.
 * The active health check means Traefik only sends traffic to the new
 * container once it answers on the health path.
 *
 * Multiple subdomains share one router with an OR-ed Host rule, so a single
 * container can answer on every hostname assigned to it.
 */
export function buildTraefikLabels(input: TraefikLabelInput): Record<string, string> {
  const name = traefikName(input.appId, input.serviceName);
  const subdomains = normalizeSubdomains(input);
  const healthPath = input.healthPath ?? "/";
  const rule = subdomains.map((subdomain) => `Host(\`${subdomain}.${input.baseDomain}\`)`).join(" || ");
  return {
    "traefik.enable": "true",
    "traefik.docker.network": input.network ?? "web",
    [`traefik.http.routers.${name}.rule`]: rule,
    [`traefik.http.routers.${name}.entrypoints`]: "web",
    [`traefik.http.routers.${name}.service`]: name,
    [`traefik.http.services.${name}.loadbalancer.server.port`]: String(input.port),
    [`traefik.http.services.${name}.loadbalancer.healthcheck.path`]: healthPath,
    [`traefik.http.services.${name}.loadbalancer.healthcheck.interval`]: "5s",
    [`traefik.http.services.${name}.loadbalancer.healthcheck.timeout`]: "3s",
  };
}
