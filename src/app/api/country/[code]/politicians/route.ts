import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { fetchPoliticians } from "@/app/country/[code]/politicians/fetchPoliticians";

// Re-export for any consumer that still imports types from the route file.
// New consumers should import from "@/lib/politicians/types".
export type { PoliticianData } from "@/lib/politicians/types";

// GET /api/country/[code]/politicians — Return all player characters and NPPs in the country sorted by political influence
// Auth: public
// Errors: 400
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const { politicians, playerCount, nppCount } = await fetchPoliticians(countryId);

    const response = NextResponse.json({
      politicians,
      total: politicians.length,
      playerCount,
      nppCount,
    });
    response.headers.set("Cache-Control", "s-maxage=120, stale-while-revalidate=300, no-transform");
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
