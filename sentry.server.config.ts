// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

// RAILWAY_ENVIRONMENT_NAME is injected on all Railway deployments.
// Disabling locally prevents MongoParseError / MONGODB_URI-missing noise flooding the dashboard.
const railwayEnv = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_SERVICE_NAME;
const isProduction = railwayEnv === "production";
const sentryEnabled = !!railwayEnv;

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,

  enabled: sentryEnabled,

  // Deploy identifier (full git SHA) injected via next.config.ts. Ties every
  // event to a specific build and matches uploaded source-map artifacts.
  release: process.env.SENTRY_RELEASE,

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: isProduction ? 0.02 : 1,

  // SSE at /api/events holds connections open for minutes — excluding avoids skewing Performance stats
  ignoreTransactions: [
    "GET /api/events",
    "GET /api/game/turn/status",
    "GET /api/players/online",
    "GET /api/client-status",
    "GET /api/client-nav",
    "POST /api/analytics/pageview",
  ],

  // Structured logs shipped to GlitchTip's Logs view in every environment.
  // Self-hosted GlitchTip has no per-event billing, so production logs are
  // safe to keep on and are essential for reconstructing "it just didn't work".
  enableLogs: true,

  integrations: [
    // Mirror server-side console.warn/console.error into GlitchTip Logs. This
    // captures the large body of existing console-only error handling without
    // rewriting every call site, turning silent console output into a queryable
    // forensic trail correlated with traces.
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],

  // Disable sending user PII (Personally Identifiable Information) to error tracking
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: false,

  beforeSend(event) {
    const value = event.exception?.values?.[0];
    const frames = value?.stacktrace?.frames ?? [];
    const hasAppFrame = frames.some((f) => f.in_app === true);

    // React streaming-SSR teardown artifact: when a client disconnects (or a
    // render aborts) mid-stream, Node's WebStreams internals throw
    // "controller[kState].transformAlgorithm is not a function". The stack is
    // ENTIRELY node:internal frames — there is nothing to fix in app code — so
    // it is dropped only when no in-app frame is present (a real in-app
    // TransformStream misuse would still report).
    if ((value?.value ?? "").includes("transformAlgorithm is not a function") && !hasAppFrame) {
      return null;
    }

    return event;
  },
});
