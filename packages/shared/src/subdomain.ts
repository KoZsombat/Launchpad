export const RESERVED_SUBDOMAINS = ["panel", "proxmox", "www"] as const;

export const DNS_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const VOLUME_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/** Validate a subdomain label and reserved-name rules. Input must already be lowercase. */
export function validateSubdomain(value: string): ValidationResult {
  if (!value) return { ok: false, reason: "Subdomain is required." };
  if (value !== value.toLowerCase()) {
    return { ok: false, reason: "Subdomain must be lowercase." };
  }
  if (value.length > 63) {
    return { ok: false, reason: "Subdomain must be 63 characters or fewer." };
  }
  if (!DNS_LABEL_REGEX.test(value)) {
    return {
      ok: false,
      reason: "Use lowercase letters, numbers and hyphens; must start and end with a letter or number.",
    };
  }
  if ((RESERVED_SUBDOMAINS as readonly string[]).includes(value)) {
    return { ok: false, reason: `"${value}" is reserved for the infrastructure.` };
  }
  return { ok: true };
}

export function validateSlug(value: string): ValidationResult {
  if (!value) return { ok: false, reason: "Name is required." };
  if (value !== value.toLowerCase()) {
    return { ok: false, reason: "Name must be lowercase." };
  }
  if (value.length > 63) {
    return { ok: false, reason: "Name must be 63 characters or fewer." };
  }
  if (!SLUG_REGEX.test(value)) {
    return {
      ok: false,
      reason: "Use lowercase letters, numbers and hyphens; must start and end with a letter or number.",
    };
  }
  return { ok: true };
}

export function isReservedSubdomain(value: string): boolean {
  return (RESERVED_SUBDOMAINS as readonly string[]).includes(value);
}

export function appUrl(subdomain: string, baseDomain: string): string {
  const scheme = baseDomain === "localhost" ? "http" : "https";
  return `${scheme}://${subdomain}.${baseDomain}`;
}
