/**
 * Structured API error handling.
 * Use for consistent error responses across routes.
 */
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { alertOps } from "@/lib/observability/alertOps";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }

  toJson(): { error: string; code?: string; details?: unknown } {
    const body: { error: string; code?: string; details?: unknown } = {
      error: this.message,
    };
    if (this.code) body.code = this.code;
    if (this.details !== undefined) body.details = this.details;
    return body;
  }
}

/**
 * Create a 400 Bad Request error.
 */
export function badRequest(message: string, details?: unknown): ApiError {
  return new ApiError(400, message, "BAD_REQUEST", details);
}

/**
 * Create a 401 Unauthorized error.
 */
export function unauthorized(message = "Authentication required"): ApiError {
  return new ApiError(401, message, "UNAUTHORIZED");
}

/**
 * Create a 403 Forbidden error.
 */
export function forbidden(message = "Forbidden"): ApiError {
  return new ApiError(403, message, "FORBIDDEN");
}

/**
 * Create a 404 Not Found error.
 */
export function notFound(message = "Not found"): ApiError {
  return new ApiError(404, message, "NOT_FOUND");
}

/**
 * Create a 409 Conflict error.
 */
export function conflict(message: string, details?: unknown): ApiError {
  return new ApiError(409, message, "CONFLICT", details);
}

/**
 * Detect a MongoDB duplicate-key error (E11000) by shape, without
 * importing the driver type — keeps this helper usable from edge runtimes
 * and avoids coupling tests to mongodb-internal classes.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === 11000 || code === "11000";
}

/**
 * Create a 500 Internal Server Error.
 * Log the underlying error server-side; return generic message to client.
 */
export function internalError(message = "Internal server error", cause?: unknown): ApiError {
  if (cause && process.env.NODE_ENV === "development") {
    console.error("[ApiError]", message, cause);
  } else if (cause) {
    console.error("[ApiError]", message);
  }
  return new ApiError(500, message, "INTERNAL_ERROR");
}

/**
 * True for errors that indicate a fault (infrastructure or programming bug)
 * rather than a user-facing validation message. Use to decide whether a
 * command-engine throw should be surfaced as a clean 4xx (validation) or routed
 * to {@link handleRouteError} for capture (genuine failure). Without this, the
 * common `catch → 400 with err.message` idiom masks DB/infra failures as
 * validation errors that never reach Sentry.
 */
export function isUnexpectedError(error: unknown): boolean {
  if (error instanceof ApiError) return false;
  if (
    error instanceof TypeError ||
    error instanceof RangeError ||
    error instanceof ReferenceError
  ) {
    return true;
  }
  // MongoServerError and Node system errors carry a numeric `code`.
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "number"
  );
}

/**
 * Optional diagnostic context for {@link handleRouteError}. Pass `request` (and
 * optionally a static `route` template like "/api/bonds/[bondId]") so the
 * captured event is tagged with the endpoint and HTTP method instead of landing
 * as an anonymous "Unhandled error". `extra` carries relevant entity ids
 * (corpId, bondId, amount) for forensic reconstruction.
 */
export interface RouteErrorContext {
  request?: Request;
  route?: string;
  extra?: Record<string, unknown>;
}

/**
 * Handle an error in an API route: if it's ApiError, return its JSON response.
 * Otherwise tag, capture to Sentry, and return 500.
 *
 * User attribution is set centrally by the auth guards (see
 * `setUserContext` in @/lib/observability/context), so captured events are
 * already tied to a user; this adds endpoint/method/entity context.
 */
export function handleRouteError(error: unknown, context?: RouteErrorContext): NextResponse {
  if (error instanceof ApiError) {
    // Expected 4xx business errors are returned to the client and intentionally
    // NOT sent to Sentry — they are not faults.
    return NextResponse.json(error.toJson(), { status: error.status });
  }

  const tags: Record<string, string | boolean> = { component: "api" };
  if (context?.request) {
    tags["http.method"] = context.request.method;
    try {
      tags["http.route"] = context.route ?? new URL(context.request.url).pathname;
    } catch {
      if (context.route) tags["http.route"] = context.route;
    }
  } else if (context?.route) {
    tags["http.route"] = context.route;
  }
  if (isDuplicateKeyError(error)) tags["db.duplicateKey"] = true;

  console.error("[API] Unhandled error:", error);
  Sentry.captureException(error, { tags, extra: context?.extra });
  alertOps(error, { tags, extra: context?.extra });
  const apiErr = internalError(
    process.env.NODE_ENV === "development" && error instanceof Error
      ? error.message
      : "Internal server error",
    error
  );
  return NextResponse.json(apiErr.toJson(), { status: 500 });
}
