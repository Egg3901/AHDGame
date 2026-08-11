// GET /api/admin/alts/calibration — how well the alt-detection confidence
// score is CALIBRATED against moderator dispositions on `altClusters`
// (forensics-v2 Wave 3).
//
// Distinct from `GET /api/admin/alts/tuning`, which asks which individual
// SIGNALS discriminate. This route asks the prior question about the
// aggregate number the whole system is built on: when a ring is scored 80%,
// is it confirmed roughly 80% of the time? It returns reliability bins, a
// Brier score and skill score against the base-rate prior, expected/maximum
// calibration error, a precision/recall sweep over candidate cluster
// thresholds, and per-signal precision.
//
// Auth: requireAdmin only. Same reasoning as the tuning route — this reasons
// about (and recommends changes to) the scoring config, which is itself
// admin-only to edit (`PUT /api/admin/alts/config`, plan §4.6).
// Errors: 401, 403
//
// GET /api/admin/alts/calibration -> CalibrationReport (see
//   src/lib/altDetection/calibration.ts for the full shape, the ground-truth
//   caveats, and the method).
//
// ADVISORY ONLY and read-only end to end — it never writes to
// `gameConfig.altScoring` or `altClusters`. An admin applies any threshold
// recommendation through `PUT /api/admin/alts/config`.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { computeCalibrationReport } from "@/lib/altDetection/calibration";

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const report = await computeCalibrationReport(db);
    return NextResponse.json(report);
  } catch (error) {
    return handleRouteError(error);
  }
}
