import { z, type ZodSchema } from "zod";
import { HEX_OBJECT_ID_REGEX } from "@/lib/utils/objectIdHex";

/** Default request-body size cap (bytes) enforced by {@link parseJsonBody}. */
export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

/**
 * Parse and validate JSON request body with Zod.
 * Returns { success: true, data } or { success: false, error, status }.
 *
 * Enforces a body-size cap (default {@link DEFAULT_MAX_BODY_BYTES}) so a
 * hostile client can't buffer an unbounded payload into memory: bodies with a
 * declared Content-Length over the cap are rejected before reading, and
 * chunked/undeclared bodies are checked against the cap after buffering the
 * text but before JSON.parse. Override per-call via `options.maxBytes`.
 */
export async function parseJsonBody<T>(
  request: Request,
  schema: ZodSchema<T>,
  options?: { maxBytes?: number }
): Promise<{ success: true; data: T } | { success: false; error: string; status: number }> {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BODY_BYTES;

  // Fast path: reject on the declared Content-Length before buffering anything.
  const declaredLength = parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { success: false, error: "Request body too large", status: 413 };
  }

  let raw: unknown;
  try {
    const text = await request.text();
    // Chunked bodies carry no Content-Length; cap the buffered text before
    // JSON.parse. (UTF-16 code units lower-bound the UTF-8 byte count, so this
    // never rejects a body that is actually under the cap.)
    if (text.length > maxBytes) {
      return { success: false, error: "Request body too large", status: 413 };
    }
    raw = JSON.parse(text);
  } catch {
    return { success: false, error: "Invalid JSON body", status: 400 };
  }

  const result = schema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }

  const first = result.error.issues[0];
  const path = first?.path?.join(".") || "body";
  const message = first ? `${path}: ${first.message}` : "Validation failed";
  return { success: false, error: message, status: 400 };
}

/**
 * Safely parse a multipart/form-data request body.
 *
 * `request.formData()` throws `TypeError: Failed to parse body as FormData`
 * when a client sends a malformed, truncated, or aborted multipart upload —
 * a client-side bad request, not a server fault. Calling it unguarded turns
 * those into 500s plus noisy GlitchTip events. This wrapper converts the
 * parse failure into a clean 400 the caller can return directly.
 */
export async function parseFormData(
  request: Request
): Promise<{ success: true; data: FormData } | { success: false; error: string; status: number }> {
  try {
    const data = await request.formData();
    return { success: true, data };
  } catch {
    return { success: false, error: "Invalid or malformed form data", status: 400 };
  }
}

/**
 * Parse a positive integer from URLSearchParams, clamped to [min, max].
 * Non-finite or NaN values use `defaultValue` (also clamped).
 */
export function parseBoundedIntParam(
  searchParams: URLSearchParams,
  key: string,
  defaultValue: number,
  min: number,
  max: number
): number {
  const raw = searchParams.get(key);
  const parsed = parseInt(raw ?? String(defaultValue), 10);
  const base = Number.isFinite(parsed) ? parsed : defaultValue;
  return Math.min(max, Math.max(min, base));
}

/** Common schemas for reuse */
export const schemas = {
  objectId: z.string().regex(HEX_OBJECT_ID_REGEX, "Invalid ID format"),
  /** Same pattern as {@link schemas.objectId}; distinct message for NPP-scoped fields. */
  nppObjectId: z.string().regex(HEX_OBJECT_ID_REGEX, "Invalid NPP ID format"),
  email: z.string().email("Invalid email"),
  password: z.string().min(1, "Password required"),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username must be at most 20 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
};
