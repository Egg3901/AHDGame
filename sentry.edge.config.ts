// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/observability/scrubSentryEvent";
import {
  dropSentryLog,
  SENTRY_DATA_COLLECTION,
  SENTRY_TRACE_LIFECYCLE,
} from "@/lib/observability/sentryPrivacy";

const railwayEnv = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_SERVICE_NAME;
const isProduction = railwayEnv === "production";
const sentryEnabled = !!railwayEnv;

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  enabled: sentryEnabled,

  // Deploy identifier (full git SHA) injected via next.config.ts.
  release: process.env.SENTRY_RELEASE,
  environment:
    process.env.SENTRY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV,

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: isProduction ? 0.1 : 1,
  traceLifecycle: SENTRY_TRACE_LIFECYCLE,

  beforeSendLog: dropSentryLog,

  // Do not collect user identity, cookies, headers, bodies or query strings.
  dataCollection: SENTRY_DATA_COLLECTION,
  beforeSend: scrubSentryEvent,
});
