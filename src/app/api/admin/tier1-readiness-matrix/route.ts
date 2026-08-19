/**
 * GET /api/admin/tier1-readiness-matrix
 *
 * Admin diagnostic — publishes the 1953 proposed Tier-1 readiness matrix
 * (#3723): autonomous/player verdicts, capability blockers with follow-up
 * issue refs, and visible reclassifications applied to the world entity
 * manifest. Deterministic / DB-free.
 *
 * Auth: requireAdmin
 * Errors: 403
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { buildTier1ReadinessMatrixDiagnosticNow } from "@/lib/admin/tier1ReadinessMatrixReport";

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const report = buildTier1ReadinessMatrixDiagnosticNow();
    return NextResponse.json(report);
  } catch (error) {
    return handleRouteError(error);
  }
}
