/**
 * Lazy client-side access to `@sentry/nextjs`.
 *
 * The full browser SDK is ~450KB+. A static import from any module in the
 * shared layout/landing graph (instrumentation-client, fetchJson via Navbar,
 * error UI) pulls that into the initial JS shell for every anonymous visit.
 * Dynamic import keeps the SDK in an async chunk; callers that need to report
 * an error pay the load cost at report time (or share a chunk already loading
 * from deferred init).
 */

type SentryClient = typeof import("@sentry/nextjs");

let loadPromise: Promise<SentryClient> | null = null;
let loaded: SentryClient | null = null;

/** Start (or reuse) loading the browser Sentry SDK. Safe to call repeatedly. */
export function loadSentryClient(): Promise<SentryClient> {
  if (loaded) return Promise.resolve(loaded);
  if (!loadPromise) {
    loadPromise = import("@sentry/nextjs").then((mod) => {
      loaded = mod;
      return mod;
    });
  }
  return loadPromise;
}

/** Fire-and-forget exception capture after the SDK chunk loads. */
export function captureClientException(
  exception: unknown,
  captureContext?: Parameters<SentryClient["captureException"]>[1]
): void {
  void loadSentryClient()
    .then((Sentry) => {
      Sentry.captureException(exception, captureContext);
    })
    .catch(() => {
      // SDK chunk failed to load (offline / blocked) — nothing else to do.
    });
}

/** Fire-and-forget breadcrumb after the SDK chunk loads. */
export function addClientBreadcrumb(
  breadcrumb: Parameters<SentryClient["addBreadcrumb"]>[0]
): void {
  void loadSentryClient()
    .then((Sentry) => {
      Sentry.addBreadcrumb(breadcrumb);
    })
    .catch(() => {
      // ignore
    });
}
