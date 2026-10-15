/**
 * Classify client request failures that are transient infrastructure, not
 * application faults.
 *
 * A dropped connection, a client-side timeout, or a gateway answer (502, 503,
 * 504) during a deploy or restart says nothing about our code. These failures
 * should drive a retryable error state in the UI and should not be reported to
 * Sentry. Everything else (500, unexpected JSON, thrown application errors)
 * stays reportable.
 */

/** Gateway statuses: the edge could not get an answer from the app. */
const GATEWAY_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/** Browser messages for a fetch that never completed (Chrome, Safari, Firefox). */
const TRANSPORT_MESSAGE =
  /failed to fetch|load failed|networkerror when attempting to fetch|network connection was lost|network request failed/i;

export function isGatewayStatus(status: number): boolean {
  return GATEWAY_STATUSES.has(status);
}

/**
 * True for a request that never got a usable answer: a network drop while
 * connecting or while reading the body, or an `AbortSignal.timeout` firing.
 * A caller-initiated `AbortError` is not included; callers handle that as a
 * cancellation, not a failure.
 */
export function isTransportFailure(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; message?: unknown };
  if (e.name === "TimeoutError") return true;
  return (
    e.name === "TypeError" && typeof e.message === "string" && TRANSPORT_MESSAGE.test(e.message)
  );
}

/** Transport failure, or an HTTP error carrying a gateway status. */
export function isTransientRequestFailure(err: unknown): boolean {
  if (isTransportFailure(err)) return true;
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; status?: unknown };
  return e.name === "HttpError" && typeof e.status === "number" && isGatewayStatus(e.status);
}
