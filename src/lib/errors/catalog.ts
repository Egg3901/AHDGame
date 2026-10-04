/**
 * Typed error-code catalog shared by API routes, client fetch helpers and the
 * error screens. Pure data: no db, clock, env or random. Every error a player
 * can see should resolve to one of these codes so a report ("PAGE_NOT_FOUND",
 * ref 3f9a...) maps straight to a cause.
 */

export const ERROR_CATALOG = {
  BAD_REQUEST: {
    status: 400,
    message: "The request was not valid.",
    retryable: false,
  },
  VALIDATION_FAILED: {
    status: 422,
    message: "Some of the submitted values were not valid.",
    retryable: false,
  },
  UNAUTHORIZED: {
    status: 401,
    message: "You need to sign in to do that.",
    retryable: false,
  },
  FORBIDDEN: {
    status: 403,
    message: "You do not have access to this.",
    retryable: false,
  },
  NOT_FOUND: {
    status: 404,
    message: "That could not be found.",
    retryable: false,
  },
  CONFLICT: {
    status: 409,
    message: "That conflicts with the current state. Refresh and try again.",
    retryable: true,
  },
  RATE_LIMITED: {
    status: 429,
    message: "Too many requests. Wait a moment and try again.",
    retryable: true,
  },
  INTERNAL_ERROR: {
    status: 500,
    message: "Something went wrong on our side. Try again in a moment.",
    retryable: true,
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    message: "The service is temporarily unavailable. Try again shortly.",
    retryable: true,
  },
  NETWORK_ERROR: {
    status: 0,
    message: "Could not reach the server. Check your connection and try again.",
    retryable: true,
  },
  CLIENT_ERROR: {
    status: 0,
    message: "This page hit an unexpected problem and could not finish loading.",
    retryable: true,
  },
  SERVER_RENDER_ERROR: {
    status: 500,
    message: "The server could not build this page. Try again in a moment.",
    retryable: true,
  },
  PAGE_NOT_FOUND: {
    status: 404,
    message: "There is no page at this address.",
    retryable: false,
  },
  CRITICAL_ERROR: {
    status: 500,
    message: "The app hit a problem it could not recover from.",
    retryable: true,
  },
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ERROR_CATALOG, value);
}

/** Generic catalog code for an HTTP status (fallback when a route sets none). */
export function errorCodeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 422:
      return "VALIDATION_FAILED";
    case 429:
      return "RATE_LIMITED";
    case 502:
    case 503:
    case 504:
      return "SERVICE_UNAVAILABLE";
    default:
      return status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST";
  }
}

/** Default player-facing copy for a code; unknown codes fall back to the generic 500 copy. */
export function defaultMessageFor(code: string): string {
  return isErrorCode(code) ? ERROR_CATALOG[code].message : ERROR_CATALOG.INTERNAL_ERROR.message;
}

/**
 * Shared wire shape of every API error response.
 *
 * `error` stays a plain string (the human message) because the existing
 * clients read `body.error` as text; `code` and `ref` ride alongside it. `ref`
 * is the Sentry event id when the failure was captured, else the request id.
 * Clients accept the nested `{ error: { code, message, ref } }` form too (see
 * `parseErrorBody`), so the server can switch shape without a client change.
 */
export interface ApiErrorBody {
  error: string;
  code: string;
  ref?: string;
  details?: unknown;
}

/** Short opaque id used as the `ref` when no Sentry event id exists. */
export function newRequestRef(random: () => string = defaultRandomRef): string {
  return random();
}

function defaultRandomRef(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID().replace(/-/g, "").slice(0, 16);
  return Math.random().toString(16).slice(2, 18).padEnd(16, "0");
}

export interface ParsedErrorBody {
  message?: string;
  code?: string;
  ref?: string;
}

/** Read either the flat or the nested envelope; tolerant of anything else. */
export function parseErrorBody(body: unknown): ParsedErrorBody {
  if (!body || typeof body !== "object") return {};
  const b = body as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);
  const nested =
    b.error && typeof b.error === "object" ? (b.error as Record<string, unknown>) : null;
  if (nested) {
    return {
      message: str(nested.message),
      code: str(nested.code) ?? str(b.code),
      ref: str(nested.ref) ?? str(b.ref) ?? str(b.eventId),
    };
  }
  return {
    message: str(b.error) ?? str(b.message),
    code: str(b.code),
    ref: str(b.ref) ?? str(b.eventId),
  };
}
