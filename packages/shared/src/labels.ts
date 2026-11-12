export interface TraefikLabelInput {
  appId: string;
  subdomain: string;
  baseDomain: string;
  port: number;
  healthPath?: string;
  network?: string;
}

/**
 * Builds the Docker labels Traefik reads for one app container.
 *
 * Both the old and new containers of an app receive the same router and
 * service names, so Traefik merges them into one service with two servers.
 * The active health check means Traefik only sends traffic to the new
 * container once it answers on the health path.
 */
export function buildTraefikLabels(input: TraefikLabelInput): Record<string, string> {
  const name = `lp-${input.appId}`;
  const host = `${input.subdomain}.${input.baseDomain}`;
  const healthPath = input.healthPath ?? "/";
  return {
    "traefik.enable": "true",
    "traefik.docker.network": input.network ?? "web",
    [`traefik.http.routers.${name}.rule`]: `Host(\`${host}\`)`,
    [`traefik.http.routers.${name}.entrypoints`]: "web",
    [`traefik.http.routers.${name}.service`]: name,
    [`traefik.http.services.${name}.loadbalancer.server.port`]: String(input.port),
    [`traefik.http.services.${name}.loadbalancer.healthcheck.path`]: healthPath,
    [`traefik.http.services.${name}.loadbalancer.healthcheck.interval`]: "5s",
    [`traefik.http.services.${name}.loadbalancer.healthcheck.timeout`]: "3s",
  };
}
