/**
 * Browser Sentry.init payload. Loaded via dynamic import from
 * `src/instrumentation-client.ts` so the SDK is not in the initial shared shell.
 */

import * as Sentry from "@sentry/nextjs";

import { isValuelessNonErrorRejection } from "@/lib/observability/sentryFilters";

export function initSentryClient(): typeof Sentry.captureRouterTransitionStart {
  // Browser bundles only receive NEXT_PUBLIC_* environment variables.
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  const isProduction = process.env.NODE_ENV === "production";
  // Enabled when DSN is available and not in local dev (prevents local
  // MongoParseError / MONGODB_URI-missing noise from flooding the dashboard).
  const sentryEnabled = !!dsn && isProduction;

  Sentry.init({
    dsn: dsn ?? undefined,

    enabled: sentryEnabled,

    // Deploy identifier (full git SHA) injected via next.config.ts as a
    // NEXT_PUBLIC_ var so the browser bundle can read it. Matches the uploaded
    // source-map artifacts so minified client stacks symbolicate.
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,

    sendDefaultPii: false,

    // Keep production traces useful without making hot polling endpoints expensive.
    tracesSampleRate: isProduction ? 0.02 : 1.0,
    ignoreTransactions: [
      "GET /api/events",
      "GET /api/game/turn/status",
      "GET /api/players/online",
      "GET /api/client-status",
      "GET /api/client-nav",
      "POST /api/analytics/pageview",
    ],

    // Structured logs shipped to GlitchTip's Logs view in every environment.
    enableLogs: true,

    integrations: [
      // Route browser console.warn/console.error into GlitchTip Logs so client
      // side console-only failures become queryable instead of vanishing.
      Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
    ],

    // Errors that originate entirely in browser extensions / injected third-party
    // scripts. These are never actionable from our code and were the bulk of the
    // client-side noise in GlitchTip (crypto-wallet injectors, Firefox reader
    // mode, privacy-mode storage blocks, ad scripts, reference-manager add-ons).
    ignoreErrors: [
      // Crypto-wallet extensions fighting over window.ethereum
      /window\.ethereum/i,
      "Cannot redefine property: ethereum",
      "Cannot read properties of undefined (reading 'selectedAddress')",
      // Firefox reader/pocket injectors
      /__firefox__/,
      // Privacy modes that throw on storage access
      /localStorage.*(null|getItem)/i,
      "The operation is insecure.",
      "SecurityError: The operation is insecure.",
      // Reference-manager / misc extensions
      /Zotero/,
      // Benign layout-thrash warning the browser reports as an error
      "ResizeObserver loop completed with undelivered notifications.",
      "ResizeObserver loop limit exceeded",
      // Extension messaging
      "runtime.sendMessage()",
      // Transient network / stale-deploy errors with no actionable app stack.
      // Real in-app request failures are captured with context via fetchJson
      // (see src/lib/observability/fetchJson.ts), so these bare browser errors
      // are noise: dropped chunks after a redeploy, adblock/extension-aborted
      // fetches, and offline blips.
      /ChunkLoadError/,
      /Loading chunk [\d]+ failed/,
      /Loading CSS chunk/,
      "Failed to fetch",
      "Load failed",
      "NetworkError when attempting to fetch resource.",
      "The network connection was lost.",
      "cancelled",
    ],

    // Drop anything whose top frame is an extension URL or a known third-party ad
    // host — these stacks contain no frames in our bundles.
    denyUrls: [
      /^chrome-extension:\/\//,
      /^moz-extension:\/\//,
      /^safari-(web-)?extension:\/\//,
      /googlesyndication\.com/,
      /googletagmanager\.com/,
      /\/pagead\//,
    ],

    // Filter out errors from browser extensions and third-party scripts
    beforeSend(event: Sentry.ErrorEvent, hint) {
      const message = event.exception?.values?.[0]?.value ?? "";

      // Value-less non-Error promise rejections (GlitchTip AHD-89, 98 events):
      // a promise rejected with no reason (undefined/null/empty), so the SDK
      // synthesises a placeholder event with no stack and no actionable payload.
      // Every production occurrence is WebKit (Safari / iOS) rejecting in-flight
      // router-prefetch and fetch promises during navigation teardown — an
      // app-level `reject()`/`throw undefined` bug would show up on Chrome too,
      // and a repo audit found none in client paths. Dropped as pure noise. The
      // guard is narrow (no originalException + exact value-less message), so a
      // rejection carrying a real payload keeps its "...with value: <X>" message
      // and stays reported.
      if (isValuelessNonErrorRejection(message, hint?.originalException)) return null;

      // Chrome extension messaging errors
      if (message.includes("runtime.sendMessage()")) return null;

      // Browser extensions (password managers, Grammarly, translators) mutating
      // React-managed DOM — not actionable from our code
      if (message.includes("removeChild") && message.includes("not a child")) return null;
      if (message.includes("insertBefore") && message.includes("not a child")) return null;
      if (message.includes("The object can not be found here")) return null;

      return event;
    },

    // Drop navigation transactions that were cancelled because the user hid the tab
    // or navigated away mid-load. These fire Sentry's HTTP/1.1 Overhead detector on
    // in-flight parallel fetches even though the truncation is user-initiated, not
    // a real perf regression.
    beforeSendTransaction(event) {
      const ctx = event.contexts?.trace;
      if (ctx?.status === "cancelled") return null;
      const reason = (ctx?.data as { "sentry.cancellation_reason"?: string } | undefined)?.[
        "sentry.cancellation_reason"
      ];
      if (reason === "document.hidden") return null;
      return event;
    },
  });

  return Sentry.captureRouterTransitionStart;
}
