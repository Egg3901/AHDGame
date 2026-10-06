"use client";

import {
  ERROR_CATALOG,
  defaultMessageFor,
  errorCodeForStatus,
  isErrorCode,
  parseErrorBody,
} from "@/lib/errors/catalog";
import type { ErrorCode } from "@/lib/errors/catalog";

/** What the UI needs to show a trackable error: message, catalog code, ref. */
export interface DisplayError {
  message: string;
  code: string;
  ref?: string;
  status?: number;
}

/** Read the shared error envelope off a failed response. Never throws. */
export async function readApiError(res: Response): Promise<DisplayError> {
  let parsed: ReturnType<typeof parseErrorBody> = {};
  try {
    parsed = parseErrorBody(await res.clone().json());
  } catch {
    // Not JSON (proxy HTML, empty body): fall back to the status code.
  }
  const code = parsed.code ?? errorCodeForStatus(res.status);
  const ref = parsed.ref ?? res.headers.get("x-request-id") ?? undefined;
  return {
    message: parsed.message ?? defaultMessageFor(code),
    code,
    ref,
    status: res.status,
  };
}

/**
 * Normalize anything thrown by a fetch/mutation path into a DisplayError:
 * `HttpError` (code/ref from the body), network `TypeError`, plain `Error`.
 */
export function toDisplayError(err: unknown, fallbackMessage?: string): DisplayError {
  if (err && typeof err === "object") {
    const e = err as {
      name?: string;
      message?: string;
      status?: number;
      code?: string;
      ref?: string;
      serverMessage?: string;
      digest?: string;
    };
    if (e.name === "HttpError" && typeof e.status === "number") {
      const code = e.code ?? errorCodeForStatus(e.status);
      return {
        message: e.serverMessage ?? fallbackMessage ?? defaultMessageFor(code),
        code,
        ref: e.ref,
        status: e.status,
      };
    }
    if (
      e.name === "TypeError" ||
      e.name === "AbortError" ||
      /failed to fetch|networkerror|load failed/i.test(e.message ?? "")
    ) {
      return { message: ERROR_CATALOG.NETWORK_ERROR.message, code: "NETWORK_ERROR" };
    }
    const message = typeof e.message === "string" && e.message ? e.message : undefined;
    const code = isErrorCode(e.code) ? e.code : ("CLIENT_ERROR" as ErrorCode);
    return {
      message: message ?? fallbackMessage ?? defaultMessageFor(code),
      code,
      ref: e.ref ?? e.digest,
    };
  }
  return { message: fallbackMessage ?? ERROR_CATALOG.CLIENT_ERROR.message, code: "CLIENT_ERROR" };
}
