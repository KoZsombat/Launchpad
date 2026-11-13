import type { DeploymentStatus } from "./state";
import type { DeployTarget, SourceType } from "./schemas";

export type AppStatus = "running" | "stopped" | "failed";
export type DeploymentTrigger = "manual" | "webhook" | "github-push";

export interface PublicEnvVar {
  key: string;
  /** Null for secret values — they never leave the server after being saved. */
  value: string | null;
  secret: boolean;
  hasValue: boolean;
}

export interface PublicVolume {
  containerPath: string;
  volumeName: string;
}

export interface PublicComposeService {
  name: string;
  expose: boolean;
  subdomains: string[];
  internalPort: number;
  healthPath: string;
  envVars: PublicEnvVar[];
}

export interface DeploymentSummary {
  id: string;
  appId: string;
  status: DeploymentStatus;
  trigger: DeploymentTrigger;
  imageTag: string | null;
  commitSha: string | null;
  error: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface DeploymentDetail extends DeploymentSummary {
  log: string;
}

export interface PublicApp {
  id: string;
  name: string;
  subdomain: string;
  /** Every hostname the project answers on (primary included). */
  subdomains: string[];
  url: string;
  /** Effective domain (override or the panel's global domain). */
  baseDomain: string;
  /** Per-project domain override, null when using the global default. */
  domain: string | null;
  /** Panel-wide default domain. */
  defaultDomain: string;
  sourceType: SourceType;
  deployTarget: DeployTarget;
  imageRef: string | null;
  registryUsername: string | null;
  registryPasswordSet: boolean;
  repoUrl: string | null;
  branch: string | null;
  dockerfilePath: string | null;
  buildContext: string | null;
  composeFile: string | null;
  composePath: string | null;
  composeServices: PublicComposeService[];
  composeProject: string | null;
  repoTokenSet: boolean;
  internalPort: number;
  healthPath: string;
  envVars: PublicEnvVar[];
  volumes: PublicVolume[];
  cicdEnabled: boolean;
  status: AppStatus;
  containerId: string | null;
  imageTag: string | null;
  createdAt: string;
  updatedAt: string;
  lastDeployment: DeploymentSummary | null;
}

export interface SettingsView {
  baseDomain: string;
  panelUrl: string;
  githubTokenSet: boolean;
  ghcrUsername: string | null;
  ghcrTokenSet: boolean;
  sshHost: string | null;
  sshPort: number | null;
  sshUsername: string | null;
  sshAuthMethod: "password" | "key" | null;
  sshPasswordSet: boolean;
  sshPrivateKeySet: boolean;
}

export interface CicdInfo {
  appId: string;
  panelUrl: string;
  webhookUrl: string;
  webhookSecret: string;
  workflowPath: string;
  workflowYaml: string;
  secrets: { name: string; value: string; description: string }[];
  githubPushWebhookUrl: string;
  githubTokenSet: boolean;
  repoOwner: string | null;
  repoName: string | null;
}

export interface GithubPushInfo {
  appId: string;
  branch: string;
  webhookUrl: string;
  webhookSecret: string;
  repoOwner: string | null;
  repoName: string | null;
}

export interface AvailabilityResult {
  nameAvailable: boolean;
  subdomainAvailable: boolean;
}

export interface ComposeScanPort {
  container: number;
  protocol: "tcp" | "udp";
}

export interface ComposeScanVolume {
  type: "volume" | "bind";
  source: string;
  target: string;
  readOnly: boolean;
}

export type ComposeServiceKind = "http" | "data" | "other";

export interface ComposeScanService {
  name: string;
  image: string | null;
  build: { context: string; dockerfile: string } | null;
  ports: ComposeScanPort[];
  expose: number[];
  environment: { key: string; value: string | null }[];
  volumes: ComposeScanVolume[];
  dependsOn: string[];
  hasHealthcheck: boolean;
  /** Best guess for the Traefik backend port. */
  suggestedPort: number | null;
  /** Whether the service should be published by default. */
  suggestedExpose: boolean;
  /** HTTP-facing service, data service (database/queue), or unknown. */
  suggestedKind: ComposeServiceKind;
  warnings: string[];
}

export interface ComposeScan {
  services: ComposeScanService[];
  /** Top-level named volumes, before Launchpad prefixes them. */
  volumes: string[];
  /** `${VAR}` references without a default. */
  requiredEnv: string[];
  /** `${VAR:-default}` references that already have a fallback. */
  optionalEnv: string[];
  warnings: string[];
  /** What Launchpad will change about the file. */
  notes: string[];
}

export interface ScanComposeResponse {
  compose: string;
  composePath: string | null;
  scan: ComposeScan;
}
