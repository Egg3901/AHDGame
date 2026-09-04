/**
 * MongoDB command monitoring → GlitchTip.
 *
 * Attaching to the driver's command-monitoring events instruments EVERY query
 * in one place, with zero changes to the ~1000 call sites:
 *
 *  - a `db` breadcrumb per command (command + collection + durationMS), so the
 *    trail before any captured exception shows exactly which queries ran;
 *  - a captured warning for slow queries (a stable title so they group, with
 *    the duration in `extra`), surfacing N+1 / missing-index hotspots;
 *  - a breadcrumb for failed commands so a DB fault is visible in context even
 *    when the throwing call site captures the error generically.
 *
 * Breadcrumbs land on the active Sentry request-isolation scope, so they are
 * automatically grouped per request. The command document is never recorded —
 * only the command name and target collection — to avoid leaking query
 * arguments (credentials, tokens, PII).
 */
import * as Sentry from "@sentry/nextjs";
import type { MongoClient } from "mongodb";
import type { Span } from "@sentry/nextjs";
import {
  recordDocumentsReturned,
  recordRoundTrip,
} from "@/lib/observability/mongoRoundTrips";

/** Driver chatter that carries no diagnostic value — never instrumented. */
const IGNORED_COMMANDS = new Set([
  "hello",
  "ismaster",
  "ping",
  "endSessions",
  "killCursors",
  "buildInfo",
  "getParameter",
  "saslStart",
  "saslContinue",
  "authenticate",
  "getnonce",
  "logout",
  "listCollections",
  "listIndexes",
]);

/** Per-requestId collection lookup; commandStarted carries the namespace, the
 * succeeded/failed events do not, so we briefly stash it and consume it. */
const pendingCollections = new Map<number, string>();
// Hard cap so a storm of unmatched events can never grow this unbounded.
const MAX_PENDING = 2000;

// Span-status codes (see @sentry/core SpanStatus): 1 = OK, 2 = ERROR.
const SPAN_STATUS_OK = 1 as const;
const SPAN_STATUS_ERROR = 2 as const;

/**
 * Per-requestId span, opened on commandStarted and ended on succeeded/failed.
 * This turns each Mongo command into a `db.query` span nested under the active
 * request/turn transaction, so the trace waterfall shows individual queries
 * (name + collection + duration) alongside the existing breadcrumbs.
 */
const pendingSpans = new Map<number, Span>();

export function collectionFromCommand(commandName: string, command: Record<string, unknown>): string {
  // Most commands name their collection as the command's own value
  // (`{find: "corporations"}`). `getMore` does not: its value is the cursor
  // id, and the collection sits in a separate field. Without this branch every
  // paginated batch was attributed to "unknown" — and since large result sets
  // are exactly the ones that paginate, that was most of the documents the
  // turn deserializes.
  const target = command[commandName];
  if (typeof target === "string") return target;
  const named = command.collection;
  return typeof named === "string" ? named : "unknown";
}

/** Documents in a find/getMore/aggregate reply batch; 0 for anything else. */
function batchSize(reply: unknown): number {
  const cursor = (reply as { cursor?: { firstBatch?: unknown[]; nextBatch?: unknown[] } })?.cursor;
  if (!cursor) return 0;
  return (cursor.firstBatch ?? cursor.nextBatch ?? []).length;
}

let attached = false;

/**
 * Attach command-monitoring listeners to a MongoClient. Idempotent and a no-op
 * under test. The client must be created with `monitorCommands: true`.
 */
export function attachMongoCommandMonitor(client: MongoClient): void {
  if (attached || process.env.NODE_ENV === "test") return;
  if (process.env.OBSERVABILITY_DB_MONITOR === "false") return;
  attached = true;

  client.on("commandStarted", (event) => {
    if (IGNORED_COMMANDS.has(event.commandName)) return;
    if (pendingCollections.size >= MAX_PENDING) {
      pendingCollections.clear();
      // Drop orphaned spans alongside the collections they map to, so a storm
      // of unmatched events can't leak unfinished spans either.
      for (const span of pendingSpans.values()) span.end();
      pendingSpans.clear();
    }
    const collection = collectionFromCommand(
      event.commandName,
      event.command as Record<string, unknown>
    );
    pendingCollections.set(event.requestId, collection);
    // Per-phase round-trip attribution (AHD_TURN_ROUNDTRIP_PROFILE=1). A
    // boolean check when off.
    recordRoundTrip(collection);

    // Only materialize a DB span when we're already inside a RECORDING trace
    // (a sampled request/turn transaction). This is the single most important
    // safety valve here: the game issues thousands of Mongo commands per turn,
    // so creating a span for every one — 98% of which belong to unsampled
    // traces and would just be dropped — would allocate needlessly on the
    // hottest path and, on the 2% of sampled turns, bloat the transaction with
    // thousands of child spans. Gating on the active span means DB spans appear
    // exactly in the traces you'd want to inspect, and never otherwise. The
    // breadcrumbs + slow-query capture below run unconditionally, as before.
    const active = Sentry.getActiveSpan();
    if (active?.isRecording()) {
      pendingSpans.set(
        event.requestId,
        Sentry.startInactiveSpan({
          name: `db.${event.commandName}.${collection}`,
          op: "db.query",
          attributes: { "db.operation": event.commandName, "db.collection": collection },
        })
      );
    }
  });

  client.on("commandSucceeded", (event) => {
    if (IGNORED_COMMANDS.has(event.commandName)) return;
    const collection = pendingCollections.get(event.requestId) ?? "unknown";
    pendingCollections.delete(event.requestId);

    // Documents returned, for the round-trip profiler. Round trips rank what
    // production pays (latency per call); documents rank what singleplayer
    // pays (deserialization per document), and one aggregate returning 61k
    // documents is a single round trip.
    recordDocumentsReturned(collection, batchSize(event.reply));

    const span = pendingSpans.get(event.requestId);
    if (span) {
      pendingSpans.delete(event.requestId);
      span.setStatus({ code: SPAN_STATUS_OK });
      span.end();
    }

    Sentry.addBreadcrumb({
      category: "db",
      type: "query",
      level: "info",
      message: `${event.commandName} ${collection}`,
      data: { durationMS: event.duration, collection },
    });

    // Slow queries are a perf signal, not an error. They are captured above as
    // an info breadcrumb (with durationMS) so they enrich any real error that
    // follows in the same session — we deliberately do NOT mint a standalone
    // GlitchTip issue per (command, collection), which flooded the error
    // tracker with non-actionable "Slow Mongo query" noise.
  });

  client.on("commandFailed", (event) => {
    if (IGNORED_COMMANDS.has(event.commandName)) return;
    const collection = pendingCollections.get(event.requestId) ?? "unknown";
    pendingCollections.delete(event.requestId);

    const span = pendingSpans.get(event.requestId);
    if (span) {
      pendingSpans.delete(event.requestId);
      span.setStatus({
        code: SPAN_STATUS_ERROR,
        message: (event.failure as Error | undefined)?.message,
      });
      span.end();
    }

    Sentry.addBreadcrumb({
      category: "db",
      type: "query",
      level: "error",
      message: `FAILED ${event.commandName} ${collection}`,
      data: {
        durationMS: event.duration,
        collection,
        error: (event.failure as Error | undefined)?.message,
      },
    });
  });
}

/** Test-only: reset module state between cases. */
export function __resetMongoMonitorForTest(): void {
  attached = false;
  pendingCollections.clear();
  pendingSpans.clear();
}
