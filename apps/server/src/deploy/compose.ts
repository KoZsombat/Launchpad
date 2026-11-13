import { buildTraefikLabels } from "@launchpad/shared";
import type {
  ComposeScan,
  ComposeScanPort,
  ComposeScanService,
  ComposeScanVolume,
  ComposeServiceKind,
} from "@launchpad/shared";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

type YamlMap = Record<string, unknown>;

export interface ParsedCompose {
  document: YamlMap;
  scan: ComposeScan;
}

const DATA_IMAGE =
  /\b(postgres|postgresql|mysql|mariadb|mongo|mongodb|redis|valkey|memcached|rabbitmq|kafka|clickhouse|elasticsearch|opensearch|minio|cassandra|couchdb|influxdb|neo4j)\b/i;
const DATA_NAME =
  /(^|[-_.])(db|database|postgres|postgresql|mysql|mariadb|mongo|mongodb|redis|cache|queue|broker|rabbitmq|kafka|memcached)([-_.]|$)/i;
const DATA_HEALTHCHECK =
  /(pg_isready|redis-cli|mysqladmin|mongosh|mongo\s|cqlsh|clickhouse-client|rabbitmq-diagnostics|kafka-topics|_cat\/health)/i;
const HTTP_IMAGE = /\b(nginx|httpd|caddy|traefik|haproxy|envoy)\b/i;
const HTTP_PORTS = new Set([
  80, 443, 3000, 3001, 3002, 3003, 4000, 4200, 4321, 5000, 5173, 5174, 6000, 7000, 8000,
  8001, 8080, 8081, 8082, 8888, 9000,
]);
const WEB_NAME = /(^|[-_.])(web|www|frontend|front|ui|admin|api|backend|server|app|site|proxy|gateway|client)([-_.]|$)/i;

export function classifyComposeService(input: {
  name: string;
  image: string | null;
  build: unknown;
  ports: number[];
  healthcheck?: unknown;
}): { kind: ComposeServiceKind; expose: boolean } {
  const image = input.image ?? "";
  const healthcheck = JSON.stringify(input.healthcheck ?? "");
  const port = input.ports[0];
  if (DATA_IMAGE.test(image) || DATA_NAME.test(input.name) || DATA_HEALTHCHECK.test(healthcheck)) {
    return { kind: "data", expose: false };
  }
  if (HTTP_IMAGE.test(image) || (port !== undefined && HTTP_PORTS.has(port)) || WEB_NAME.test(input.name)) {
    return { kind: "http", expose: port !== undefined };
  }
  return { kind: "other", expose: false };
}

const ENV_REFERENCE =
  /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?([-?+])([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

function asMap(value: unknown): YamlMap | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as YamlMap;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function parsePortNumber(value: string): number | null {
  const first = value.split("-")[0] ?? "";
  if (!/^\d+$/.test(first)) return null;
  const port = Number(first);
  return port >= 1 && port <= 65_535 ? port : null;
}

function parsePortEntry(entry: unknown, warnings: string[]): ComposeScanPort[] {
  if (typeof entry === "number") {
    return entry >= 1 && entry <= 65_535 ? [{ container: entry, protocol: "tcp" }] : [];
  }
  if (typeof entry === "string") {
    const [address, protocolRaw] = entry.split("/") as [string, string | undefined];
    const protocol = protocolRaw?.toLowerCase() === "udp" ? "udp" : "tcp";
    const segments = address.split(":");
    const containerRaw = segments[segments.length - 1] ?? "";
    if (containerRaw.includes("-")) {
      warnings.push(`Port range "${entry}" is reduced to its first container port.`);
    }
    if (segments.length > 2) {
      warnings.push(`Host binding "${entry}" is published by Launchpad instead; the host part is ignored.`);
    }
    const container = parsePortNumber(containerRaw);
    return container ? [{ container, protocol }] : [];
  }
  const map = asMap(entry);
  if (map) {
    const target = stringValue(map.target);
    const protocol = stringValue(map.protocol)?.toLowerCase() === "udp" ? "udp" : "tcp";
    const container = target ? parsePortNumber(target) : null;
    return container ? [{ container, protocol }] : [];
  }
  return [];
}

function parseExposeEntry(entry: unknown): number | null {
  const text = stringValue(entry);
  if (!text) return null;
  return parsePortNumber(text.split("/")[0] ?? "");
}

function parseEnvironment(
  value: unknown,
  serviceName: string,
  warnings: string[],
): { key: string; value: string | null }[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    const entries: { key: string; value: string | null }[] = [];
    for (const item of value) {
      const text = stringValue(item);
      if (!text) continue;
      const index = text.indexOf("=");
      if (index === -1) {
        entries.push({ key: text, value: null });
      } else {
        entries.push({ key: text.slice(0, index), value: text.slice(index + 1) });
      }
    }
    return entries;
  }
  const map = asMap(value);
  if (map) {
    return Object.entries(map).map(([key, raw]) => ({ key, value: stringValue(raw) }));
  }
  warnings.push(`Service "${serviceName}" has an unusable environment block; it was ignored.`);
  return [];
}

function parseVolumeEntry(entry: unknown, warnings: string[]): ComposeScanVolume | null {
  if (typeof entry === "string") {
    const parts = entry.split(":");
    if (parts.length === 1) {
      warnings.push(`Anonymous volume "${entry}" is recreated on every deployment.`);
      return null;
    }
    const [source, target, mode] = parts as [string, string | undefined, string | undefined];
    if (!source || !target) return null;
    const isBind =
      source.startsWith("/") || source.startsWith(".") || source.startsWith("~") || source.includes("/");
    return {
      type: isBind ? "bind" : "volume",
      source,
      target,
      readOnly: Boolean(mode?.split(",").includes("ro")),
    };
  }
  const map = asMap(entry);
  if (map) {
    const type = stringValue(map.type) === "bind" ? "bind" : "volume";
    const source = stringValue(map.source);
    const target = stringValue(map.target);
    if (!source || !target) {
      warnings.push("An anonymous volume is recreated on every deployment.");
      return null;
    }
    return { type, source, target, readOnly: Boolean(map.read_only) };
  }
  return null;
}

function parseDependsOn(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => stringValue(entry)).filter((entry): entry is string => Boolean(entry));
  }
  const map = asMap(value);
  return map ? Object.keys(map) : [];
}

function parseBuild(value: unknown): { context: string; dockerfile: string } | null {
  if (typeof value === "string") return { context: value, dockerfile: "Dockerfile" };
  const map = asMap(value);
  if (!map) return null;
  return {
    context: stringValue(map.context) ?? ".",
    dockerfile: stringValue(map.dockerfile) ?? "Dockerfile",
  };
}

function collectEnvReferences(
  value: unknown,
  required: Set<string>,
  optional: Set<string>,
): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(ENV_REFERENCE)) {
      if (match[0] === "$$") continue;
      const braced = match[1];
      if (braced) {
        if (match[2] === "-" || match[2] === "+") optional.add(braced);
        else required.add(braced);
        continue;
      }
      const bare = match[4];
      if (bare) required.add(bare);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectEnvReferences(entry, required, optional);
    return;
  }
  const map = asMap(value);
  if (map) {
    for (const entry of Object.values(map)) collectEnvReferences(entry, required, optional);
  }
}

export function parseCompose(text: string): ParsedCompose {
  if (!text.trim()) throw new Error("The compose file is empty.");
  let document: unknown;
  try {
    document = parseYaml(text, { uniqueKeys: false });
  } catch (error) {
    throw new Error(`Invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = asMap(document);
  if (!root) throw new Error("The compose file must contain a YAML mapping.");
  const servicesMap = asMap(root.services);
  if (!servicesMap || Object.keys(servicesMap).length === 0) {
    throw new Error("The compose file does not define any services.");
  }

  const globalWarnings: string[] = [];
  if (root.include !== undefined) {
    globalWarnings.push("`include` is not resolved by Launchpad; merge included files into one compose file.");
  }
  const topVolumes = asMap(root.volumes);
  const topVolumeNames = topVolumes ? Object.keys(topVolumes) : [];

  const services: ComposeScanService[] = [];
  for (const [name, raw] of Object.entries(servicesMap)) {
    const service = asMap(raw);
    if (!service) {
      globalWarnings.push(`Service "${name}" is not a mapping and was skipped.`);
      continue;
    }
    const warnings: string[] = [];
    const ports = Array.isArray(service.ports)
      ? service.ports.flatMap((entry) => parsePortEntry(entry, warnings))
      : [];
    const expose = Array.isArray(service.expose)
      ? service.expose
          .map((entry) => parseExposeEntry(entry))
          .filter((port): port is number => port !== null)
      : [];
    const environment = parseEnvironment(service.environment, name, warnings);
    const volumes = Array.isArray(service.volumes)
      ? service.volumes
          .map((entry) => parseVolumeEntry(entry, warnings))
          .filter((volume): volume is ComposeScanVolume => volume !== null)
      : [];
    const build = parseBuild(service.build);
    const image = stringValue(service.image);
    const healthcheck = asMap(service.healthcheck);
    const hasHealthcheck = Boolean(healthcheck && healthcheck.disable !== true);
    const dependsOn = parseDependsOn(service.depends_on);

    if (!image && !build) {
      warnings.push("Service has neither an image nor a build context.");
    }
    if (service.build !== undefined && asMap(service.build)?.dockerfile_inline !== undefined) {
      warnings.push("`dockerfile_inline` is not supported; use a Dockerfile path.");
    }
    if (service.env_file !== undefined) {
      warnings.push("`env_file` is read from the target host; values are not shown here.");
    }
    if (service.network_mode !== undefined) {
      warnings.push("`network_mode` prevents Traefik from routing this service unless it publishes its own ingress.");
    }
    if (service.privileged === true || service.cap_add !== undefined) {
      warnings.push("Privileged mode and added capabilities are kept as-is; review them before deploying.");
    }
    if (service.extends !== undefined) {
      warnings.push("`extends` is not resolved by Launchpad.");
    }
    if (service.profiles !== undefined) {
      warnings.push("Profiles are ignored; this service is deployed with the stack.");
    }
    for (const volume of volumes) {
      if (volume.type === "volume" && topVolumes && !(volume.source in topVolumes)) {
        warnings.push(`Named volume "${volume.source}" is not declared under top-level volumes.`);
      }
    }
    const tcpPort = ports.find((port) => port.protocol === "tcp");
    const suggestedPort = tcpPort?.container ?? expose[0] ?? null;
    const classification = classifyComposeService({
      name,
      image,
      build,
      ports: suggestedPort ? [suggestedPort] : [],
      healthcheck: service.healthcheck,
    });
    if (classification.kind === "data") {
      warnings.push("Looks like a data service; it is not published by default.");
    }
    if (!suggestedPort) {
      warnings.push("No container port detected; enter the port the service listens on.");
    }
    if (ports.some((port) => port.protocol === "udp")) {
      warnings.push("UDP ports cannot be routed through Traefik and are ignored.");
    }

    services.push({
      name,
      image,
      build,
      ports,
      expose,
      environment,
      volumes,
      dependsOn,
      hasHealthcheck,
      suggestedPort,
      suggestedExpose: classification.expose,
      suggestedKind: classification.kind,
      warnings,
    });
  }

  const requiredEnv = new Set<string>();
  const optionalEnv = new Set<string>();
  collectEnvReferences(root, requiredEnv, optionalEnv);
  for (const name of requiredEnv) optionalEnv.delete(name);
  const notes = [
    "Published host ports are removed; Traefik reaches each routed container port directly.",
    "Services are attached to the external `web` network so Traefik can reach them.",
  ];
  if (services.some((service) => service.volumes.some((volume) => volume.type === "volume"))) {
    notes.push("Named volumes are prefixed per project and kept across deployments.");
  }
  if (services.some((service) => service.build)) {
    notes.push("Build services are built on the panel host when the project comes from a repository; inline files must use images.");
  }

  return {
    document: root,
    scan: {
      services,
      volumes: topVolumeNames,
      requiredEnv: [...requiredEnv],
      optionalEnv: [...optionalEnv],
      warnings: globalWarnings,
      notes,
    },
  };
}

export function scanCompose(text: string): ComposeScan {
  return parseCompose(text).scan;
}

function interpolateString(
  text: string,
  env: Record<string, string>,
  missing: Set<string>,
): string {
  return text.replace(ENV_REFERENCE, (match, braced, operator, argument, bare) => {
    if (match === "$$") return "$";
    if (braced) {
      const name = braced as string;
      const value = env[name];
      if (operator === "-") return value !== undefined && value !== "" ? value : ((argument as string) ?? "");
      if (operator === "+") {
        if (value !== undefined && value !== "") return (argument as string) ?? "";
        return "";
      }
      if (operator === "?") {
        if (value !== undefined) return value;
        missing.add(name);
        return "";
      }
      if (value !== undefined) return value;
      missing.add(name);
      return "";
    }
    const name = bare as string;
    const value = env[name];
    if (value !== undefined) return value;
    missing.add(name);
    return "";
  });
}

function interpolateValue(
  value: unknown,
  env: Record<string, string>,
  missing: Set<string>,
): unknown {
  if (typeof value === "string") return interpolateString(value, env, missing);
  if (Array.isArray(value)) {
    return value.map((entry) => interpolateValue(entry, env, missing));
  }
  const map = asMap(value);
  if (map) {
    return Object.fromEntries(
      Object.entries(map).map(([key, entry]) => [key, interpolateValue(entry, env, missing)]),
    );
  }
  return value;
}

export interface ComposeRouteConfig {
  name: string;
  expose: boolean;
  subdomains: string[];
  internalPort: number;
  healthPath: string;
  env: Record<string, string>;
}

export interface GenerateComposeOptions {
  compose: string;
  appId: string;
  baseDomain: string;
  deploymentId: string;
  projectName: string;
  network: string;
  volumePrefix: string;
  services: ComposeRouteConfig[];
  env: Record<string, string>;
  remote: boolean;
  /** Only repository-sourced projects can build images. */
  allowBuild?: boolean;
  log?: (line: string) => void;
}

export interface GeneratedCompose {
  yaml: string;
  /** External Docker volumes that must exist before `compose up`. */
  volumes: string[];
  routedServices: { name: string; internalPort: number; healthPath: string }[];
  serviceNames: string[];
  warnings: string[];
}

function labelMap(service: YamlMap): Record<string, string> {
  const labels = service.labels;
  const result: Record<string, string> = {};
  if (Array.isArray(labels)) {
    for (const entry of labels) {
      const text = stringValue(entry);
      if (!text) continue;
      const index = text.indexOf("=");
      if (index === -1) result[text] = "";
      else result[text.slice(0, index)] = text.slice(index + 1);
    }
    return result;
  }
  const map = asMap(labels);
  if (map) {
    for (const [key, value] of Object.entries(map)) {
      result[key] = stringValue(value) ?? "";
    }
  }
  return result;
}

function environmentMap(value: unknown): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = stringValue(entry);
      if (!text) continue;
      const index = text.indexOf("=");
      if (index === -1) result[text] = null;
      else result[text.slice(0, index)] = text.slice(index + 1);
    }
    return result;
  }
  const map = asMap(value);
  if (map) {
    for (const [key, entry] of Object.entries(map)) {
      result[key] = stringValue(entry);
    }
  }
  return result;
}

function applyVolumePrefix(service: YamlMap, namedVolumes: Set<string>, prefix: string): void {
  if (!Array.isArray(service.volumes)) return;
  service.volumes = service.volumes.map((entry: unknown) => {
    if (typeof entry === "string") {
      const parts = entry.split(":");
      if (parts.length < 2) return entry;
      const source = parts[0] ?? "";
      if (!namedVolumes.has(source)) return entry;
      parts[0] = `${prefix}${source}`;
      return parts.join(":");
    }
    const map = asMap(entry);
    if (!map || stringValue(map.type) !== "volume") return entry;
    const source = stringValue(map.source);
    if (!source || !namedVolumes.has(source)) return entry;
    return { ...map, source: `${prefix}${source}` };
  });
}

export function generateComposeFile(options: GenerateComposeOptions): GeneratedCompose {
  const parsed = parseCompose(options.compose);
  const document = structuredClone(parsed.document);
  const servicesMap = asMap(document.services);
  if (!servicesMap) throw new Error("The compose file does not define any services.");

  const missing = new Set<string>();
  const interpolated = interpolateValue(document, options.env, missing);
  const root = asMap(interpolated);
  if (!root) throw new Error("The compose file must contain a YAML mapping.");
  if (missing.size > 0) {
    throw new Error(
      `Missing values for compose variables: ${[...missing].sort().join(", ")}. Add them to the project's environment variables.`,
    );
  }
  const services = asMap(root.services) as YamlMap;

  const topVolumes = asMap(root.volumes) ?? {};
  const namedVolumes = new Set<string>();
  for (const raw of Object.values(services)) {
    const service = asMap(raw);
    if (!service || !Array.isArray(service.volumes)) continue;
    for (const entry of service.volumes) {
      if (typeof entry === "string") {
        const parts = entry.split(":");
        const source = parts[0] ?? "";
        if (parts.length >= 2 && source && !source.startsWith("/") && !source.startsWith(".") && !source.startsWith("~") && !source.includes("/")) {
          namedVolumes.add(source);
        }
      } else {
        const map = asMap(entry);
        if (map && stringValue(map.type) === "volume") {
          const source = stringValue(map.source);
          if (source) namedVolumes.add(source);
        }
      }
    }
  }

  const buildServices = Object.entries(services)
    .filter(([, raw]) => asMap(raw)?.build !== undefined)
    .map(([name]) => name);
  if (options.remote && buildServices.length > 0) {
    throw new Error(
      `Remote projects cannot build images on the remote host. Prebuild the image locally, use an image reference, or switch the target to local. Services: ${buildServices.join(", ")}.`,
    );
  }
  if (!options.remote && !options.allowBuild && buildServices.length > 0) {
    throw new Error(
      `Compose builds need a repository source so the build context exists. Add a repository and compose path, or replace builds with image references. Services: ${buildServices.join(", ")}.`,
    );
  }

  const routeConfigs = new Map(options.services.map((config) => [config.name, config]));
  const routedServices: GeneratedCompose["routedServices"] = [];
  const warnings: string[] = [];

  for (const [name, raw] of Object.entries(services)) {
    const service = asMap(raw);
    if (!service) continue;
    const config = routeConfigs.get(name);
    if (config && config.expose) {
      if (service.network_mode !== undefined) {
        throw new Error(
          `Service "${name}" uses network_mode, so Traefik cannot route it. Remove network_mode or stop publishing the service.`,
        );
      }
      const labels = labelMap(service);
      Object.assign(
        labels,
        buildTraefikLabels({
          appId: options.appId,
          subdomains: config.subdomains,
          baseDomain: options.baseDomain,
          port: config.internalPort,
          healthPath: config.healthPath,
          network: options.network,
          serviceName: name,
        }),
        {
          "launchpad.app": options.appId,
          "launchpad.deployment": options.deploymentId,
          "launchpad.managed": "true",
          "launchpad.service": name,
        },
      );
      service.labels = labels;
      const kind = classifyComposeService({
        name,
        image: stringValue(service.image),
        build: service.build,
        ports: [config.internalPort],
        healthcheck: service.healthcheck,
      });
      if (kind.kind === "data") {
        warnings.push(
          `Service "${name}" looks like a data service but is published. HTTP health checks will fail unless it serves HTTP.`,
        );
      }
      const networks = asMap(service.networks);
      if (networks) {
        networks[options.network] = {};
      } else if (Array.isArray(service.networks)) {
        const names = service.networks
          .map((entry) => stringValue(entry))
          .filter((entry): entry is string => Boolean(entry));
        if (!names.includes(options.network)) names.push(options.network);
        service.networks = Object.fromEntries(
          names.map((networkName) => [networkName, {}]),
        );
      } else {
        service.networks = { default: {}, [options.network]: {} };
      }
      routedServices.push({
        name,
        internalPort: config.internalPort,
        healthPath: config.healthPath,
      });
    } else {
      const labels = labelMap(service);
      Object.assign(labels, {
        "launchpad.app": options.appId,
        "launchpad.deployment": options.deploymentId,
        "launchpad.managed": "true",
        "launchpad.service": name,
      });
      if (Object.keys(labels).length > 0) service.labels = labels;
    }

    delete service.ports;
    if (config) {
      const environment = environmentMap(service.environment);
      for (const [key, value] of Object.entries(config.env)) environment[key] = value;
      if (Object.keys(environment).length > 0) service.environment = environment;
    }
    if (service.restart === undefined) service.restart = "unless-stopped";
    delete service.container_name;
    delete service.profiles;
    applyVolumePrefix(service, namedVolumes, options.volumePrefix);
  }

  delete root.name;
  const networks = asMap(root.networks) ?? {};
  networks[options.network] = { external: true };
  root.networks = networks;

  const volumeDefinitions: Record<string, { external: true; name: string }> = {};
  for (const name of namedVolumes) {
    const volumeName = `${options.volumePrefix}${name}`;
    volumeDefinitions[volumeName] = { external: true, name: volumeName };
  }
  if (Object.keys(volumeDefinitions).length > 0) root.volumes = volumeDefinitions;
  else delete root.volumes;

  if (topVolumes && Object.keys(topVolumes).length > 0) {
    const unused = Object.keys(topVolumes).filter((name) => !namedVolumes.has(name));
    if (unused.length > 0) {
      warnings.push(`Unused top-level volumes were dropped: ${unused.join(", ")}.`);
    }
  }

  return {
    yaml: stringifyYaml(root, { lineWidth: 0 }),
    volumes: Object.keys(volumeDefinitions),
    routedServices,
    serviceNames: Object.keys(services),
    warnings,
  };
}
