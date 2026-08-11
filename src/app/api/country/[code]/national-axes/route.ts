import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { EnactedLaw } from "@/lib/db/types/budget";
import { getLegislationTypeById } from "@/lib/legislationTypeAliases";
import { computeNationalAxes } from "@/lib/policy/nationalAxes";
import { buildAxisEvents, replayAxesTimeline } from "@/lib/policy/axesTimeline";
import {
  assembleNationalPolicyRecords,
  nationalLawCountryQuery,
} from "@/lib/policy/nationalPolicyRecords";

// GET /api/country/[code]/national-axes - National Ideology axes (equal-weight
// average over implemented national laws), the 5 most recent axis movers, and
// the replayed drift series. Powers the country lander's National Ideology band.
// Auth: public
// Errors: 400
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const db = await getDb();

    const { records, types } = await assembleNationalPolicyRecords(db, countryId);
    const axes = computeNationalAxes(records);

    // Replay enacted-law history (oldest first) for the movers feed and the
    // drift sparkline. Coverage is "since first recorded law" — see axesTimeline.
    const laws = await db
      .collection<EnactedLaw>("enactedLaws")
      .find({
        scope: "national",
        ...nationalLawCountryQuery(countryId),
        repealedAt: { $exists: false },
      })
      .sort({ enactedAt: 1 })
      .toArray();
    const events = buildAxisEvents(laws, (id) =>
      getLegislationTypeById(types.legislationTypeMap, id)
    );
    const { points, movers } = replayAxesTimeline(events);

    return NextResponse.json(
      { axes, movers, drift: { points } },
      { headers: { "Cache-Control": "no-store, max-age=0, no-transform" } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
