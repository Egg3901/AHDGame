import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseBoundedIntParam } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { computeIntakeSummary } from "@/lib/admin/intake/intakeSummary";

// GET /api/admin/intake/summary — First-party signup to character to return funnel, by UTC day (?days=1-90, default 30).
// Auth: requireAdmin
// Errors: 403
export async function GET(request: Request) {
  try {
    const gate = await requireAdmin();
    if (!gate.ok) return gate.response;
    const { searchParams } = new URL(request.url);
    const days = parseBoundedIntParam(searchParams, "days", 30, 1, 90);
    const summary = await computeIntakeSummary(await getDb(), days);
    return NextResponse.json(summary, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
