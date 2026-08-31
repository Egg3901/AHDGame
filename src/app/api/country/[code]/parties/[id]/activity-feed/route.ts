import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { getDb } from "@/lib/mongodb";
import {
  describeSlateActivity,
  getPartyActivityFeed,
  shouldIncludePartyOverviewTreasuryActivity,
} from "@/lib/parties/queries/activityFeed";

// GET /api/country/[code]/parties/[id]/activity-feed - Return the shared recent activity feed.
// Auth: requireAuth
// Errors: 400, 401, 404
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });

    const url = new URL(request.url);
    const beforeRaw = url.searchParams.get("before");
    const limitRaw = url.searchParams.get("limit");
    const before = beforeRaw ? new Date(beforeRaw) : null;
    if (before && Number.isNaN(before.getTime())) {
      return NextResponse.json({ error: "Invalid 'before' timestamp" }, { status: 400 });
    }
    // `Math.max(1, Math.min(100, NaN))` is NaN, not 1, so an unparseable
    // `?limit` used to reach Mongo's `.limit()` as NaN. Validate before
    // clamping and fall back to the default rather than 400ing a feed read.
    // `Number("")` is 0, not NaN, so an empty `?limit=` must be treated as
    // absent here or it would clamp to 1 instead of falling back to 30.
    const limitParsed = limitRaw === null || limitRaw.trim() === "" ? NaN : Number(limitRaw);
    const limit = Number.isFinite(limitParsed)
      ? Math.max(1, Math.min(100, Math.floor(limitParsed)))
      : 30;

    return NextResponse.json(
      await getPartyActivityFeed(db, {
        countryId,
        partyId: String(party.sequentialId),
        before,
        limit,
      })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export { describeSlateActivity, shouldIncludePartyOverviewTreasuryActivity };
