import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { buildCountryEconomyOutlook } from "@/lib/economy/queries/countryEconomyOutlook";

interface RouteParams {
  params: Promise<{ code: string }>;
}

// GET /api/country/[code]/economy - National Economic Outlook payload (pulse strip, real economy, markets, sector mix).
// Auth: public
// Errors: 400
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country code");
    }

    const db = await getDb();
    const outlook = await buildCountryEconomyOutlook(db, countryId);
    return NextResponse.json(outlook);
  } catch (error) {
    return handleRouteError(error);
  }
}
