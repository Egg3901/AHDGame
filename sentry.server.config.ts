// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { scrubPushRequest } from "@/lib/nativePush/telemetry";
import { scrubSentryEvent } from "@/lib/observability/scrubSentryEvent";
import { isNextRenderStreamDisconnect } from "@/lib/observability/sentryFilters";
import {
  dropSentryLog,
  SENTRY_DATA_COLLECTION,
  SENTRY_TRACE_LIFECYCLE,
} from "@/lib/observability/sentryPrivacy";
import { describeSentryIngest, formatSentryIngestLog } from "@/lib/observability/sentryIngest";

// RAILWAY_ENVIRONMENT_NAME is injected on all Railway deployments.
// Disabling locally prevents MongoParseError / MONGODB_URI-missing noise flooding the dashboard.
const railwayEnv = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_SERVICE_NAME;
const isProduction = railwayEnv === "production";
const sentryEnabled = !!railwayEnv;

// One boot line (host and project id only, never the key) so a missing or
// malformed DSN is visible in deploy logs instead of silently dropping events.
const ingest = describeSentryIngest(process.env);
if (ingest.problem !== "disabled-environment") {
  const log = formatSentryIngestLog(ingest);
  if (ingest.enabled) console.log(log);
  else console.error(log);
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  enabled: sentryEnabled,

  // Deploy identifier (full git SHA) injected via next.config.ts. Ties every
  // event to a specific build and matches uploaded source-map artifacts.
  release: process.env.SENTRY_RELEASE,
  environment:
    process.env.SENTRY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV,

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: isProduction ? 0.1 : 1,
  // Keeps ignoreTransactions and beforeSendTransaction effective under v11.
  traceLifecycle: SENTRY_TRACE_LIFECYCLE,

  // SSE at /api/events holds connections open for minutes — excluding avoids skewing Performance stats
  ignoreTransactions: [
    "GET /api/events",
    "GET /api/game/turn/status",
    "GET /api/players/online",
    "GET /api/client-status",
    "GET /api/client-nav",
    "POST /api/analytics/pageview",
  ],

  // SaaS logs are usage-billed. Keep errors and sampled traces as the initial
  // signal, then enable logs only after a volume and cost review.
  beforeSendLog: dropSentryLog,

  // Do not collect user identity, cookies, headers, bodies, query strings,
  // database payloads or local variables.
  dataCollection: SENTRY_DATA_COLLECTION,

  beforeSendTransaction: scrubPushRequest,

  beforeSend(event) {
    scrubPushRequest(event);
    if (isNextRenderStreamDisconnect(event)) return null;
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

    return scrubSentryEvent(event);
  },
});
