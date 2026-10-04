import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireCron } from "@/lib/api/requireCron";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { logRequest } from "@/lib/api/requestLog";
import { PatreonReconcileLockBusyError, runPatreonReconcile } from "@/lib/patreon/reconcile";

export { runReconcile } from "@/lib/patreon/reconcile";

// GET|POST /api/cron/patreon-reconcile — reconcile AHD supporter roles against
// the live Patreon campaign membership. DRY RUN by default; pass ?apply=true to
// actually write. Auth: requireCron (Authorization: Bearer $CRON_SECRET).
//
// Decision rules (per run):
//   - toGrant: an ACTIVE paid patron matched by a linked patreonUserId whose
//     AHD patreonTier differs from Patreon -> applyPatreonStatus.
//   - toDerole: an AHD supporter positively matched to a Patreon record that is
//     no longer an active paid patron AND not already counting down
//     (patreonExpiresAt == null) -> startPatreonGracePeriod (30d), never an
//     immediate clear.
//   - unmatched identities: left untouched, retried on every apply pass, and
//     recorded with pseudonymous fingerprints and first/last-seen counters.
//   - unmatchedActivePatrons: active paid patrons with no matching AHD user ->
//     reported only, no change.
//   - expired: a positively matched inactive patron whose grace has elapsed
//     -> clearExpiredPatreonBenefits. Missing provider records never expire a
//     supporter merely because no match was found.

async function handle(req: Request): Promise<Response> {
  const start = Date.now();
  const path = "/api/cron/patreon-reconcile";

  if (!requireCron(req)) {
    logRequest(req.method, path, 401, Date.now() - start);
    console.warn("[cron/patreon-reconcile] Unauthorized cron attempt");
    return errorResponse(401, "Unauthorized");
  }

  const apply = new URL(req.url).searchParams.get("apply") === "true";

  try {
    const db = await getDb();
    const result = await runPatreonReconcile(db, apply);
    const durationMs = Date.now() - start;
    logRequest(req.method, path, 200, durationMs);
    console.info("[cron/patreon-reconcile] Completed", {
      durationMs,
      dryRun: result.dryRun,
      ...result.counts,
    });
    const { auditKeys: _auditKeys, ...publicResult } = result;
    return NextResponse.json(publicResult);
  } catch (error) {
    if (!(error instanceof PatreonReconcileLockBusyError)) {
      Sentry.captureMessage("Patreon reconciliation failed", {
        level: "error",
        tags: { route: path, errorType: error instanceof Error ? error.name : "UnknownError" },
      });
    }
    if (error instanceof PatreonReconcileLockBusyError) {
      logRequest(req.method, path, 409, Date.now() - start);
      return errorResponse(409, "A Patreon reconciliation is already running.");
    }
    logRequest(req.method, path, 500, Date.now() - start);
    console.error("[cron/patreon-reconcile] Failed; see sanitized reconciliation audit record.");
    return handleRouteError(error);
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
