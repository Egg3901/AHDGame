"use client";

/**
 * ErrorRef — a compact, copyable error reference code shown on error surfaces.
 *
 * Displays a short alphanumeric code derived from the Sentry event ID (or the
 * Next.js error digest). Clicking copies the full code to clipboard. This lets
 * players reference a specific error in bug reports without pasting full stack
 * traces.
 *
 * Usage:
 *   <ErrorRef error={error} />
 *   <ErrorRef code="abc123" />
 */

interface ErrorRefProps {
  /** The error object from a React error boundary or API catch. */
  error?: Error & { digest?: string };
  /** Or a pre-captured event/digest code. */
  code?: string;
  /** Optional label override. */
  label?: string;
}

export function ErrorRef({ error, code, label = "Error code" }: ErrorRefProps) {
  const ref = code ?? error?.digest ?? extractEventId(error);

  if (!ref) return null;

  // Shorten UUIDs to first 8 chars for display — still unique enough to search.
  const short = ref.length > 12 ? ref.slice(0, 8) : ref;

  const copy = () => {
    void navigator.clipboard.writeText(ref).catch(() => {});
  };

  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-md border border-card-border bg-card-muted/50 px-2 py-1 font-mono text-xs text-muted transition-colors hover:bg-card-muted hover:text-foreground"
      title={`Click to copy: ${ref}`}
    >
      <span className="opacity-60">{label}:</span>
      <span className="font-medium">{short}</span>
      <svg className="h-3 w-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
        />
      </svg>
    </button>
  );
}

/**
 * Try to extract a Sentry event ID from an error object.
 * Sentry attaches the event ID to the error's `sentryEventId` property when
 * captured via `captureException`.
 */
function extractEventId(error?: Error): string | undefined {
  const sentryEventId = (error as unknown as { sentryEventId?: string })?.sentryEventId;
  if (sentryEventId) return sentryEventId;
  return undefined;
}
