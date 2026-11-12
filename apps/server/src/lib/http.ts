import { z } from "zod";
import { ApiError } from "./errors";

export interface BodySchema<T> {
  safeParse: (input: unknown) =>
    | { success: true; data: T }
    | { success: false; error: z.ZodError };
}

export function parseBody<T>(schema: BodySchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApiError(422, "Validation failed.", result.error.issues);
  }
  return result.data;
}

export function requireParam(
  params: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const value = params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new ApiError(400, `Missing route parameter "${name}".`);
  }
  return value;
}
