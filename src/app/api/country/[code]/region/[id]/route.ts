import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { State } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

// GET /api/country/[code]/region/[id] — Return the state document for a region
// Auth: public
// Errors: 400, 404
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;

    const db = await getDb();
    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }
    return NextResponse.json(state, {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400, no-transform",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
