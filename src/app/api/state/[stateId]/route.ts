import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, notFound } from "@/lib/api/errors";
import type { State } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

// GET /api/state/[stateId] — Returns a single state document by its string ID (e.g. "SCO", "CT").
// Auth: public
// Errors: 404
export async function GET(request: Request, { params }: { params: Promise<{ stateId: string }> }) {
  try {
    const { stateId } = await params;
    const { searchParams } = new URL(request.url);
    // Accept ?country=<id> to disambiguate cross-country state-ID collisions
    // (CN HB / DE HB). Omitting country preserves the legacy uniqueness
    // assumption for callers that haven't migrated yet — accept the risk.
    const countryId = searchParams.get("country")?.toUpperCase() as CountryId | undefined;
    const db = await getDb();
    const state = await db
      .collection<State>("states")
      .findOne(countryId ? { _id: stateId, countryId } : { _id: stateId });
    if (!state) throw notFound("State not found");
    return NextResponse.json(state, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600, no-transform" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
