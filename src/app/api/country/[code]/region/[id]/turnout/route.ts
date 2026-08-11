import { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { buildRegionTurnoutResponse } from "@/lib/demographics/regionTurnout";

// GET /api/country/[code]/region/[id]/turnout — Return demographic turnout data for a region including baselines and modifiers
// Auth: public
// Errors: 400, 404
/**
 * GET /api/country/[code]/region/[id]/turnout
 * Fetch demographic turnout data for a state
 * Returns baseline, modifiers, and actual turnout for all Layer 1 demographics
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;

    if (!stateId) {
      return NextResponse.json({ error: "State ID required" }, { status: 400 });
    }

    // SSOT shared with the region page's server fetch (getRegionTurnout).
    const response = await buildRegionTurnoutResponse(stateId, countryId);
    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
