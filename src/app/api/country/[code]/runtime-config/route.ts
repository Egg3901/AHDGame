/**
 * Public endpoint exposing the runtime-mutable country fields from
 * countryState (Phase 1 promotion). Client components that need to react
 * to mid-game regime changes (Stage 4 conversion, reform-action vote-
 * multiplier tier changes, ruling-party swaps) fetch from here instead
 * of hard-coding COUNTRY_CONFIGS values that only reflect seed state.
 *
 * GET /api/country/[code]/runtime-config
 * No auth — same disclosure level as the country overview page.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCountryState } from "@/lib/countryState";

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const db = await getDb();
    const runtime = await getCountryState(db, countryId);

    return NextResponse.json({
      countryId,
      governmentType: runtime.governmentType,
      rulingPartyId: runtime.rulingPartyId,
      opsVoteMultipliers: runtime.opsVoteMultipliers,
      hasLeaderConfidenceModel: runtime.hasLeaderConfidenceModel,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
