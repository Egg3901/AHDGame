// GET /api/admin/alts/tuning — advisory alt-scoring weight-tuning
// suggestions, learned from moderator dispositions on `altClusters`
// (confirmed vs. dismissed rings). Forensics-v2 Wave 2 "learning loop"
// (see FORENSICS-V2-PLAN.md §C).
//
// Auth: requireAdmin only. This is admin-depth tuning info that reasons
// about (and previews changes to) the scoring config, which is itself
// admin-only to edit (`PUT /api/admin/alts/config`, plan §4.6) — unlike
// `GET /api/admin/alts/clusters`/`config`, which are readable by any
// moderator.
// Errors: 401, 403
//
// GET /api/admin/alts/tuning -> TuningReport (see
//   src/lib/altDetection/tuning.ts for the full shape and the
//   discrimination-score method).
//
// ADVISORY ONLY. This route is read-only end to end — it never writes to
// `gameConfig.altScoring` or `altClusters`. An admin reviews the
// suggestions here and applies any of them (or not) through the existing
// `PUT /api/admin/alts/config`.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { computeTuningSuggestions } from "@/lib/altDetection/tuning";

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const report = await computeTuningSuggestions(db);
    return NextResponse.json(report);
  } catch (error) {
    return handleRouteError(error);
  }
}
