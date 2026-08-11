/**
 * Custom span helper for instrumenting game operations.
 *
 * Sentry spans are OpenTelemetry-compatible, so wrapping a block in `withSpan`
 * produces a trace segment visible in GlitchTip's Performance / trace view with
 * a duration, status, and structured tags/data — no separate OTel SDK needed.
 *
 * Usage:
 *   await withSpan("turn.phase.fundGeneration", { tags: { turn: 42 } }, async () => {
 *     await doWork();
 *   });
 *
 * The span is created with `startInactiveSpan` (it does NOT become the active
 * span), so it nests under whatever transaction is already active (the turn
 * cron request, an API route, etc.) without hijacking the scope. Status is set
 * to OK on success and ERROR on a thrown exception, and the span is always
 * ended in `finally` so a throw can never leak an unfinished span.
 */
import * as Sentry from "@sentry/nextjs";

// Sentry span status codes (see @sentry/core SpanStatus): 1 = OK, 2 = ERROR.
// (0 = UNSET is the default before we resolve the outcome.)
const SPAN_STATUS_OK = 1 as const;
const SPAN_STATUS_ERROR = 2 as const;

export interface SpanOptions {
  /** Indexed tags for filtering/grouping in GlitchTip (kept small + low-cardinality). */
  tags?: Record<string, string | number | boolean>;
  /** Structured data attributes attached to the span (higher cardinality is fine). */
  data?: Record<string, unknown>;
  /** Span operation category, e.g. "turn.phase", "db.query". Defaults to "function". */
  op?: string;
}

/**
 * Run `fn` inside a Sentry span named `name`. Returns whatever `fn` returns.
 *
 * On success the span status is OK; on a thrown error the status is ERROR (with
 * the error message) and the error is re-thrown so callers keep their existing
 * error handling. The span is ended in `finally`.
 */
export async function withSpan<T>(
  name: string,
  options: SpanOptions,
  fn: (span: Sentry.Span) => Promise<T>
): Promise<T> {
  const span = Sentry.startInactiveSpan({
    name,
    op: options.op ?? "function",
    attributes: {
      ...options.tags,
      ...normalizeData(options.data),
    },
  });

  try {
    const result = await fn(span);
    span.setStatus({ code: SPAN_STATUS_OK });
    return result;
  } catch (err) {
    span.setStatus({
      code: SPAN_STATUS_ERROR,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    span.end();
  }
}

/**
 * Span attributes must be primitives (or arrays of primitives). Objects are
 * JSON-stringified so structured `data` doesn't get silently dropped.
 */
function normalizeData(
  data: Record<string, unknown> | undefined
): Record<string, string | number | boolean> | undefined {
  if (!data) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else {
      try {
        out[key] = JSON.stringify(value);
      } catch {
        out[key] = String(value);
      }
    }
  }
  return out;
}
