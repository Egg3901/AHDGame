// GET /api/admin/alts/metrics — operational health of the alt-scoring
// pipeline itself, from the `altScoringRuns` telemetry collection
// (forensics-v2 Wave 3).
//
// `runAltScoring` is a best-effort hourly cron that swallows every throw so
// it can never break the cron loop. That makes its failures silent: a run
// that scores zero links because an upstream field stopped being populated
// looks exactly like a quiet hour. This route surfaces the run history so
// the difference is visible — candidate volume, confidence distribution
// drift, per-signal firing trends, pool truncation, errored runs, and
// explicit warnings when a signal that used to fire has gone silent.
//
// Auth: requireAdmin only. This is pipeline-operations depth (cron health,
// index/pool sizing), not the ring-review surface moderators use.
// Errors: 401, 403
//
// Query params:
//   limit — run records to return, 1..200, default 48 (two days of hourly
//           runs). Clamped rather than rejected, so a bad value degrades to
//           the default instead of 400-ing a dashboard.
//
// GET /api/admin/alts/metrics -> AltMetricsReport (see
//   src/lib/altDetection/runMetrics.ts).
//
// Read-only.
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { computeMetricsReport } from "@/lib/altDetection/runMetrics";

const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 200;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const raw = Number(request.nextUrl.searchParams.get("limit"));
    const limit =
      Number.isFinite(raw) && raw > 0 ? Math.min(MAX_LIMIT, Math.floor(raw)) : DEFAULT_LIMIT;

    const db = await getDb();
    const report = await computeMetricsReport(db, limit);
    return NextResponse.json(report);
  } catch (error) {
    return handleRouteError(error);
  }
}
