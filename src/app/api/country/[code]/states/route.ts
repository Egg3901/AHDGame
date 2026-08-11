/**
 * GET /api/country/[code]/states — Return all states/regions for a country.
 * Used for corporation relocation dropdown and other state selection UIs.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { State } from "@/lib/db/types";

// GET /api/country/[code]/states — Return all states/regions for a country
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
    const states = await db
      .collection<State>("states")
      .find({ countryId })
      .project<{ _id: string; name: string }>({ _id: 1, name: 1 })
      .toArray();

    return NextResponse.json({
      states: states.map((s) => ({
        id: s._id,
        name: s.name,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
