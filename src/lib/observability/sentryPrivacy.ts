/**
 * Shared Sentry v11 privacy and telemetry baseline for the browser, server and
 * edge SDK initializations.
 *
 * v10 collected no default PII while `sendDefaultPii` was unset or false. v11
 * removed that flag, and an unset `dataCollection` now collects user identity,
 * cookies, headers, bodies, query strings, database payloads and local
 * variables. Every category is turned off explicitly here so the upgrade does
 * not widen what leaves the process. `scrubSentryEvent` stays as the second
 * line of defense on error events.
 */

import type * as Sentry from "@sentry/nextjs";

type SentryOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type DataCollection = NonNullable<SentryOptions["dataCollection"]>;

export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: false, response: false },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  stackFrameVariables: false,
} as const satisfies DataCollection;

/**
 * v11 streams spans by default, which turns `beforeSendTransaction` and
 * `ignoreTransactions` into no-ops. Static transactions keep the existing
 * transaction filters and scrubbers in force.
 */
export const SENTRY_TRACE_LIFECYCLE = "static" satisfies SentryOptions["traceLifecycle"];

/**
 * v11 removed `enableLogs`; any `Sentry.logger` call or logging integration now
 * ships logs. SaaS logs are usage-billed, so they stay off until a volume and
 * cost review deliberately removes this drop.
 */
export function dropSentryLog(): null {
  return null;
}
