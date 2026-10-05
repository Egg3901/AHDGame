"use client";

import { ERROR_CATALOG, isErrorCode } from "@/lib/errors/catalog";
import { toDisplayError, type DisplayError } from "@/lib/errors/client";

interface InlineErrorProps {
  /** Anything a fetch/mutation path caught, or an already-normalized DisplayError. */
  error: unknown;
  /** Override the message when the server did not supply a useful one. */
  fallbackMessage?: string;
  onRetry?: () => void;
  className?: string;
}

function isDisplayError(v: unknown): v is DisplayError {
  return !!v && typeof v === "object" && "code" in v && "message" in v && !("name" in v);
}

/**
 * Inline failure notice for client fetches and mutations: message plus the
 * trackable code and ref, with an optional retry. Renders nothing for a
 * null/undefined error so callers can pass their error state directly.
 */
export function InlineError({
  error,
  fallbackMessage,
  onRetry,
  className = "text-sm text-error",
}: InlineErrorProps) {
  if (error === null || error === undefined || error === false || error === "") return null;
  // A plain string is a message that already carries its own code (see
  // `apiErrorText`), so it is shown as is.
  const d: Omit<DisplayError, "code"> & { code?: string } =
    typeof error === "string"
      ? { message: error }
      : isDisplayError(error)
        ? error
        : toDisplayError(error, fallbackMessage);
  const retryable = d.code && isErrorCode(d.code) ? ERROR_CATALOG[d.code].retryable : true;

  return (
    <div role="alert" className={className}>
      <span>{d.message}</span>{" "}
      {d.code && (
        <span className="font-mono text-xs text-muted" data-testid="inline-error-code">
          {d.code}
          {d.ref ? ` / ${d.ref.length > 12 ? d.ref.slice(0, 8) : d.ref}` : ""}
        </span>
      )}
      {onRetry && retryable && (
        <button
          type="button"
          onClick={onRetry}
          className="ml-2 text-xs font-medium text-primary hover:underline"
        >
          Retry
        </button>
      )}
    </div>
  );
}
