// GET /api/country/[code]/pm/appoint/[voteId] — Fetch PM appointment vote status and tallies
// Auth: Optional (authenticated users also receive their own vote)
// Error codes: 404
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { verifyAuth } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
import { getParliamentaryCountryId } from "@/lib/government/parliamentaryCountry";
import { getPmAppointmentVoteView } from "@/lib/government/queries/parliamentaryGovernment";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string; voteId: string }> }
) {
  try {
    const { code, voteId } = await params;
    const countryId = getParliamentaryCountryId(code);

    const db = await getDb();
    const user = await verifyAuth();
    return NextResponse.json({
      vote: await getPmAppointmentVoteView(db, countryId, voteId, user?.userId ?? null),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
