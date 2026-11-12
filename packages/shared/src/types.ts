import type { DeploymentStatus } from "./state";
import type { SourceType } from "./schemas";

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
  url: string;
  sourceType: SourceType;
  imageRef: string | null;
  registryUsername: string | null;
  registryPasswordSet: boolean;
  repoUrl: string | null;
  branch: string | null;
  dockerfilePath: string | null;
  buildContext: string | null;
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

export interface AvailabilityResult {
  nameAvailable: boolean;
  subdomainAvailable: boolean;
}
