import { z } from "zod";
import { ENV_KEY_REGEX, VOLUME_NAME_REGEX } from "./subdomain";
import { validateSlug, validateSubdomain } from "./subdomain";

export const SOURCE_TYPES = ["image", "github", "compose"] as const;
export const sourceTypeSchema = z.enum(SOURCE_TYPES);
export type SourceType = (typeof SOURCE_TYPES)[number];

export const DEPLOY_TARGETS = ["local", "remote"] as const;
export const deployTargetSchema = z.enum(DEPLOY_TARGETS);
export type DeployTarget = (typeof DEPLOY_TARGETS)[number];

/**
 * How an app is reached from outside Docker.
 * - `http`: Traefik route on the app's subdomain.
 * - `port`: publish a container port on the host (TCP or UDP).
 * - `none`: no ingress (workers, cron jobs, one-off services).
 */
export const APP_ACCESS_MODES = ["http", "port", "none"] as const;
export const appAccessSchema = z.enum(APP_ACCESS_MODES);
export type AppAccess = (typeof APP_ACCESS_MODES)[number];

export const PORT_PROTOCOLS = ["tcp", "udp"] as const;
export const portProtocolSchema = z.enum(PORT_PROTOCOLS);
export type PortProtocol = (typeof PORT_PROTOCOLS)[number];

const optionalText = (max: number) => z.string().trim().max(max).optional();

export const envVarSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, "Key is required.")
    .max(128, "Key is too long.")
    .regex(ENV_KEY_REGEX, "Use letters, numbers and underscores; cannot start with a number."),
  /** Omitted for secret variables means "keep the stored value" on update. */
  value: z.string().max(20_000).optional(),
  secret: z.boolean().default(false),
});

export const volumeSchema = z.object({
  containerPath: z
    .string()
    .trim()
    .min(1, "Container path is required.")
    .max(255)
    .refine((v) => v.startsWith("/"), "Use an absolute container path, e.g. /data.")
    .refine((v) => !v.split("/").includes(".."), "Container path cannot contain '..'."),
  volumeName: z
    .string()
    .trim()
    .min(1, "Volume name is required.")
    .regex(VOLUME_NAME_REGEX, "Use letters, numbers, dots, underscores or hyphens."),
});

const imageRefSchema = z
  .string()
  .trim()
  .min(1, "Image reference is required.")
  .max(500)
  .refine(
    (v) => /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/.test(v),
    "Use a valid Docker image reference, e.g. nginx:1.27.",
  );

const repoUrlSchema = z
  .string()
  .trim()
  .min(1, "Repository URL is required.")
  .max(500)
  .refine(
    (v) => !/\s/.test(v) && /^(https?:\/\/|git@)/.test(v),
    "Use an https:// or git@ repository URL.",
  );

const branchSchema = z
  .string()
  .trim()
  .min(1, "Branch is required.")
  .max(200)
  .refine(
    (v) => /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/.test(v),
    "Use a valid branch name without spaces.",
  );

const repoPathSchema = z
  .string()
  .trim()
  .min(1, "Path is required.")
  .max(255)
  .refine((v) => !v.startsWith("/"), "Use a path relative to the repository root.")
  .refine((v) => !v.split("/").includes(".."), "Path cannot contain '..'.");

const healthPathBaseSchema = z
  .string()
  .trim()
  .max(255)
  .refine((v) => v.startsWith("/"), "Health check path must start with '/'.");

const healthPathSchema = healthPathBaseSchema.default("/");

export const subdomainSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const result = validateSubdomain(value);
    if (!result.ok) ctx.addIssue({ code: "custom", message: result.reason });
  });

export const slugSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const result = validateSlug(value);
    if (!result.ok) ctx.addIssue({ code: "custom", message: result.reason });
  });

const HOSTNAME_REGEX =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Per-project domain. `localhost` enables local testing hostnames. */
export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .refine(
    (value) => value === "localhost" || HOSTNAME_REGEX.test(value),
    "Use a valid domain, e.g. example.com, or localhost for tests.",
  );

const portSchema = z
  .number()
  .int("Port must be a whole number.")
  .min(1, "Port must be between 1 and 65535.")
  .max(65_535, "Port must be between 1 and 65535.");

/** One compose service that Launchpad knows how to deploy and optionally route. */
export const composeServiceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Service name is required.")
    .max(100, "Service name is too long.")
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9_.-]*$/,
      "Use a valid compose service name (letters, numbers, dots, underscores or hyphens).",
    ),
  expose: z.boolean().default(true),
  subdomains: z.array(subdomainSchema).max(20, "At most 20 subdomains per service.").default([]),
  internalPort: portSchema,
  healthPath: healthPathSchema,
  envVars: z.array(envVarSchema).max(100).default([]),
});

export type ComposeServiceInput = z.infer<typeof composeServiceSchema>;

const appConfigObject = z.object({
  sourceType: sourceTypeSchema,
  imageRef: optionalText(500),
  registryUsername: optionalText(255),
  registryPassword: z.string().max(4096).optional(),
  repoUrl: optionalText(500),
  branch: optionalText(200),
  dockerfilePath: optionalText(255),
  buildContext: optionalText(255),
  repoToken: z.string().max(4096).optional(),
  internalPort: portSchema.optional(),
  /**
   * Ingress mode. Compose projects derive this from their published services,
   * so the field is accepted for single-container sources only.
   */
  access: appAccessSchema.default("http"),
  /** Host port published when `access` is `port`; defaults to the internal port. */
  hostPort: portSchema.optional(),
  portProtocol: portProtocolSchema.default("tcp"),
  healthPath: healthPathSchema,
  envVars: z.array(envVarSchema).max(100).default([]),
  volumes: z.array(volumeSchema).max(20).default([]),
  cicdEnabled: z.boolean().default(false),
  deployTarget: deployTargetSchema.default("local"),
  /** Optional per-project domain; null uses the panel's global base domain. */
  domain: domainSchema.nullable().optional(),
  /** Last scanned compose file. Kept for inline projects and as a snapshot for repo projects. */
  composeFile: z.string().max(1_000_000).optional(),
  /** Path to the compose file inside the repository, for repo-sourced projects. */
  composePath: optionalText(255),
  composeServices: z.array(composeServiceSchema).max(50).default([]),
});

type AppConfig = z.infer<typeof appConfigObject>;

function validateConfig(config: AppConfig, ctx: z.RefinementCtx): void {
  if (config.sourceType === "image") {
    if (!config.imageRef) {
      ctx.addIssue({ code: "custom", path: ["imageRef"], message: "Image reference is required." });
    } else {
      const parsed = imageRefSchema.safeParse(config.imageRef);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          path: ["imageRef"],
          message: parsed.error.issues[0]?.message ?? "Invalid image reference.",
        });
      }
    }
  } else if (config.sourceType === "github") {
    if (!config.repoUrl) {
      ctx.addIssue({ code: "custom", path: ["repoUrl"], message: "Repository URL is required." });
    } else {
      const parsed = repoUrlSchema.safeParse(config.repoUrl);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          path: ["repoUrl"],
          message: parsed.error.issues[0]?.message ?? "Invalid repository URL.",
        });
      }
    }
    if (!config.branch) {
      ctx.addIssue({ code: "custom", path: ["branch"], message: "Branch is required." });
    } else {
      const parsed = branchSchema.safeParse(config.branch);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          path: ["branch"],
          message: parsed.error.issues[0]?.message ?? "Invalid branch name.",
        });
      }
    }
    if (!config.dockerfilePath) {
      ctx.addIssue({
        code: "custom",
        path: ["dockerfilePath"],
        message: "Dockerfile path is required.",
      });
    } else if (config.dockerfilePath) {
      const parsed = repoPathSchema.safeParse(config.dockerfilePath);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          path: ["dockerfilePath"],
          message: parsed.error.issues[0]?.message ?? "Invalid Dockerfile path.",
        });
      }
    }
    if (!config.buildContext) {
      ctx.addIssue({
        code: "custom",
        path: ["buildContext"],
        message: "Build context is required (use '.' for the repository root).",
      });
    } else if (config.buildContext) {
      const parsed = repoPathSchema.safeParse(config.buildContext);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          path: ["buildContext"],
          message: parsed.error.issues[0]?.message ?? "Invalid build context.",
        });
      }
    }
  }

  if (config.sourceType !== "compose" && config.internalPort === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["internalPort"],
      message: "Internal port is required.",
    });
  }

  if (config.sourceType === "compose") {
    if (!config.composeFile && !config.repoUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["composeFile"],
        message: "Paste a compose file or provide a repository and compose path.",
      });
    }
    if (config.repoUrl) {
      const parsed = repoUrlSchema.safeParse(config.repoUrl);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          path: ["repoUrl"],
          message: parsed.error.issues[0]?.message ?? "Invalid repository URL.",
        });
      }
      if (!config.branch) {
        ctx.addIssue({ code: "custom", path: ["branch"], message: "Branch is required for repositories." });
      } else {
        const branch = branchSchema.safeParse(config.branch);
        if (!branch.success) {
          ctx.addIssue({
            code: "custom",
            path: ["branch"],
            message: branch.error.issues[0]?.message ?? "Invalid branch name.",
          });
        }
      }
    }
    if (config.composePath !== undefined) {
      const parsed = repoPathSchema.safeParse(config.composePath);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          path: ["composePath"],
          message: parsed.error.issues[0]?.message ?? "Invalid compose path.",
        });
      }
    }
    if (config.composeServices.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["composeServices"],
        message: "Scan the compose file and configure at least one service.",
      });
    }
    const serviceNames = new Set<string>();
    const subdomainOwner = new Map<string, string>();
    config.composeServices.forEach((service, index) => {
      if (serviceNames.has(service.name)) {
        ctx.addIssue({
          code: "custom",
          path: ["composeServices", index, "name"],
          message: "Duplicate service name.",
        });
      }
      serviceNames.add(service.name);

      if (service.expose) {
        if (service.subdomains.length === 0) {
          ctx.addIssue({
            code: "custom",
            path: ["composeServices", index, "subdomains"],
            message: "Add at least one subdomain for a published service.",
          });
        }

        // Subdomains on unpublished services are kept for a later republish but are
        // inert: they must not claim a hostname or collide with another route.
        const seen = new Set<string>();
        service.subdomains.forEach((subdomain, subIndex) => {
          if (seen.has(subdomain)) {
            ctx.addIssue({
              code: "custom",
              path: ["composeServices", index, "subdomains", subIndex],
              message: "Duplicate subdomain on this service.",
            });
          }
          seen.add(subdomain);
          const owner = subdomainOwner.get(subdomain);
          if (owner && owner !== service.name) {
            ctx.addIssue({
              code: "custom",
              path: ["composeServices", index, "subdomains", subIndex],
              message: `Subdomain "${subdomain}" is already used by service "${owner}".`,
            });
          }
          subdomainOwner.set(subdomain, service.name);
        });
      }

      const envKeys = new Set<string>();
      service.envVars.forEach((entry, envIndex) => {
        if (envKeys.has(entry.key)) {
          ctx.addIssue({
            code: "custom",
            path: ["composeServices", index, "envVars", envIndex, "key"],
            message: "Duplicate environment variable key.",
          });
        }
        envKeys.add(entry.key);
      });
    });
  }

  if (config.cicdEnabled && config.sourceType !== "github") {
    ctx.addIssue({
      code: "custom",
      path: ["cicdEnabled"],
      message: "CI/CD requires a GitHub source.",
    });
  }

  const keys = new Set<string>();
  config.envVars.forEach((entry, index) => {
    if (keys.has(entry.key)) {
      ctx.addIssue({
        code: "custom",
        path: ["envVars", index, "key"],
        message: "Duplicate environment variable key.",
      });
    }
    keys.add(entry.key);
  });

  const paths = new Set<string>();
  config.volumes.forEach((entry, index) => {
    if (paths.has(entry.containerPath)) {
      ctx.addIssue({
        code: "custom",
        path: ["volumes", index, "containerPath"],
        message: "Duplicate container path.",
      });
    }
    paths.add(entry.containerPath);
  });
}

/** Full application configuration, used to validate the merged record on update. */
export const appConfigSchema = appConfigObject.superRefine(validateConfig);

export const createAppSchema = appConfigObject
  .extend({
    name: slugSchema,
    /** Empty for apps without an HTTP route. */
    subdomain: z.string().trim().max(63, "Subdomain must be 63 characters or fewer."),
  })
  .superRefine((config, ctx) => {
    validateConfig(config, ctx);
    const exposed =
      config.sourceType === "compose"
        ? config.composeServices
            .filter((service) => service.expose)
            .flatMap((service) => service.subdomains)
        : null;
    const wantsHttp =
      config.sourceType === "compose" ? Boolean(exposed?.length) : config.access === "http";
    if (wantsHttp) {
      if (!config.subdomain) {
        ctx.addIssue({
          code: "custom",
          path: ["subdomain"],
          message: "Subdomain is required for HTTP apps.",
        });
      } else {
        const parsed = subdomainSchema.safeParse(config.subdomain);
        if (!parsed.success) {
          ctx.addIssue({
            code: "custom",
            path: ["subdomain"],
            message: parsed.error.issues[0]?.message ?? "Invalid subdomain.",
          });
        }
      }
    } else if (config.subdomain) {
      ctx.addIssue({
        code: "custom",
        path: ["subdomain"],
        message: "Leave the subdomain empty when the app has no HTTP route.",
      });
    }
    if (exposed === null) return;
    if (exposed.length > 0 && !exposed.includes(config.subdomain)) {
      ctx.addIssue({
        code: "custom",
        path: ["subdomain"],
        message: "Use one of the published service subdomains as the primary subdomain.",
      });
    }
  });

export const scanComposeSchema = z
  .object({
    compose: z.string().trim().min(1, "Paste a compose file.").max(1_000_000).optional(),
    repoUrl: repoUrlSchema.optional(),
    branch: branchSchema.optional(),
    composePath: repoPathSchema.optional(),
    repoToken: z.string().max(4096).optional(),
  })
  .refine((value) => Boolean(value.compose) || Boolean(value.repoUrl && value.branch), {
    message: "Paste a compose file or provide a repository URL and branch.",
    path: ["compose"],
  });

export const updateAppSchema = z
  .object({
    ...appConfigObject.shape,
    healthPath: healthPathBaseSchema,
    envVars: z.array(envVarSchema).max(100),
    volumes: z.array(volumeSchema).max(20),
    cicdEnabled: z.boolean(),
    subdomain: subdomainSchema,
    deployTarget: deployTargetSchema,
    access: appAccessSchema.optional(),
    portProtocol: portProtocolSchema.optional(),
    composeServices: z.array(composeServiceSchema).max(50),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "No changes supplied.",
  });

export const deployHookSchema = z.object({
  imageTag: z
    .string()
    .trim()
    .min(1, "imageTag is required.")
    .max(500)
    .refine(
      (v) => /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/.test(v),
      "Invalid Docker image reference.",
    ),
  commitSha: z.string().trim().max(100).optional(),
});

export const settingsSchema = z.object({
  baseDomain: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .regex(
      /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
      "Use a valid apex domain, e.g. example.com.",
    )
    .optional(),
  githubToken: z.string().max(4096).nullable().optional(),
  ghcrUsername: z.string().trim().max(255).nullable().optional(),
  ghcrToken: z.string().max(4096).nullable().optional(),
  sshHost: z.string().trim().max(255).nullable().optional(),
  sshPort: z.number().int().min(1).max(65535).nullable().optional(),
  sshUsername: z.string().trim().max(255).nullable().optional(),
  sshAuthMethod: z.enum(["password", "key"]).nullable().optional(),
  sshPassword: z.string().max(4096).nullable().optional(),
  sshPrivateKey: z.string().max(20_000).nullable().optional(),
  uploadLimitMb: z.number().int().min(1).max(4096).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: z.string().min(8, "New password must be at least 8 characters."),
});

export type EnvVarInput = z.infer<typeof envVarSchema>;
export type VolumeInput = z.infer<typeof volumeSchema>;
export type CreateAppInput = z.infer<typeof createAppSchema>;
export type UpdateAppInput = z.infer<typeof updateAppSchema>;
export type DeployHookInput = z.infer<typeof deployHookSchema>;
export type ScanComposeInput = z.infer<typeof scanComposeSchema>;
