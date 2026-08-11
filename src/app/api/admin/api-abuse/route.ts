import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { getDb } from "@/lib/mongodb";
import { scanApiAbuse, getLatestApiAbuseScan, ABUSE_THRESHOLDS } from "@/lib/api/abuseDetection";

// GET /api/admin/api-abuse[?live=1][&windowMinutes=N]
// By default returns the most recent persisted scan (written hourly by cron).
// With ?live=1 it recomputes on demand over the given look-back window.
// Report-only: this endpoint never throttles or blocks anyone.
export const GET = withAdminAuth(async (_auth, request: Request) => {
  try {
    const { searchParams } = new URL(request.url);
    const db = await getDb();

    if (searchParams.get("live") !== "1") {
      const latest = await getLatestApiAbuseScan(db);
      return NextResponse.json({
        source: "persisted",
        scan: latest,
      });
    }

    const rawMinutes = parseInt(searchParams.get("windowMinutes") ?? "", 10);
    // Clamp the look-back to a sane range (1 min … 24 h); default 60 min.
    const windowMinutes = Number.isFinite(rawMinutes)
      ? Math.min(Math.max(rawMinutes, 1), 24 * 60)
      : ABUSE_THRESHOLDS.windowMs / 60_000;

    const result = await scanApiAbuse(db, { windowMs: windowMinutes * 60_000 });
    return NextResponse.json({
      source: "live",
      windowMinutes,
      scannedRows: result.scannedRows,
      flaggedActors: result.findings.length,
      findings: result.findings,
    });
  } catch (error) {
    return handleRouteError(error);
  }
});
