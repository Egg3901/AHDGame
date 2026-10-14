import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseBoundedIntParam } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { computeIntakeSummary } from "@/lib/admin/intake/intakeSummary";
import { computeOnboardingCohorts } from "@/lib/admin/intake/onboardingCohorts";

// GET /api/admin/intake/summary — First-party signup to character to return funnel by UTC day, plus first-days onboarding cohorts (?days=1-90, default 30).
// Auth: requireAdmin
// Errors: 403
export async function GET(request: Request) {
  try {
    const gate = await requireAdmin();
    if (!gate.ok) return gate.response;
    const { searchParams } = new URL(request.url);
    const days = parseBoundedIntParam(searchParams, "days", 30, 1, 90);
    const db = await getDb();
    const summary = await computeIntakeSummary(db, days);
    const onboarding = await computeOnboardingCohorts(db, new Date(summary.since));
    return NextResponse.json(
      { ...summary, onboarding },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
