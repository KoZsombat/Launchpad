import { z } from "zod";
import { ENV_KEY_REGEX, VOLUME_NAME_REGEX } from "./subdomain";
import { validateSlug, validateSubdomain } from "./subdomain";

export const SOURCE_TYPES = ["image", "github"] as const;
export const sourceTypeSchema = z.enum(SOURCE_TYPES);
export type SourceType = (typeof SOURCE_TYPES)[number];

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
  internalPort: z
    .number()
    .int("Port must be a whole number.")
    .min(1, "Port must be between 1 and 65535.")
    .max(65_535, "Port must be between 1 and 65535."),
  healthPath: healthPathSchema,
  envVars: z.array(envVarSchema).max(100).default([]),
  volumes: z.array(volumeSchema).max(20).default([]),
  cicdEnabled: z.boolean().default(false),
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
  } else {
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
    } else {
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
    } else {
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
    subdomain: subdomainSchema,
  })
  .superRefine(validateConfig);

export const updateAppSchema = z
  .object({
    ...appConfigObject.shape,
    healthPath: healthPathBaseSchema,
    envVars: z.array(envVarSchema).max(100),
    volumes: z.array(volumeSchema).max(20),
    cicdEnabled: z.boolean(),
    subdomain: subdomainSchema,
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
