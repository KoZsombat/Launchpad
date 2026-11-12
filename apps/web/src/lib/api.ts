export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers,
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body: unknown = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent("launchpad:unauthorized"));
    }
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed with HTTP ${response.status}.`;
    const details =
      body && typeof body === "object" && "details" in body ? body.details : undefined;
    throw new ApiRequestError(message, response.status, details);
  }

  return body as T;
}

export function apiJson<T>(path: string, method: string, payload?: unknown): Promise<T> {
  return api<T>(path, {
    method,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export interface ValidationIssue {
  path: (string | number)[];
  message: string;
}

export function validationIssues(error: unknown): ValidationIssue[] {
  if (!(error instanceof ApiRequestError)) return [];
  if (!Array.isArray(error.details)) return [];
  return error.details.filter((issue): issue is ValidationIssue => {
    return Boolean(
      issue &&
        typeof issue === "object" &&
        "message" in issue &&
        typeof issue.message === "string" &&
        "path" in issue &&
        Array.isArray(issue.path),
    );
  });
}
