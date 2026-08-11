// Pure, testable predicates for client-side Sentry `beforeSend` filtering.
// Kept dependency-free so they can be unit-tested without booting the SDK.

/**
 * Detects the classic "value-less non-Error promise rejection" noise
 * (GlitchTip AHD-89): a promise rejected with no reason — `undefined`, `null`,
 * or empty — so the SDK synthesises a placeholder event with no stack and no
 * actionable payload. In production these are WebKit (Safari / iOS) rejecting
 * in-flight router-prefetch and fetch promises during navigation teardown.
 *
 * Scoped deliberately narrow so real errors are never dropped:
 *  - `originalException` must be absent (`undefined`/`null`). A genuine thrown
 *    value — even a non-Error object — carries an `originalException`, so it is
 *    reported.
 *  - The message must be one of the exact value-less SDK strings. A rejection
 *    carrying a real payload stringifies to "...with value: [object Object]"
 *    (or similar) and does NOT match, so it stays reported.
 */
export function isValuelessNonErrorRejection(message: string, originalException: unknown): boolean {
  // A real thrown value (Error or otherwise) is preserved as originalException;
  // only the value-less teardown noise has none.
  if (originalException !== undefined && originalException !== null) return false;

  const normalized = message.trim();
  return (
    normalized === "Non-Error promise rejection captured with value: undefined" ||
    normalized === "Non-Error promise rejection captured with value: null" ||
    normalized === "Non-Error promise rejection captured with value:" ||
    normalized === "Non-Error promise rejection captured"
  );
}
