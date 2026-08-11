// GET /api/country/[code]/scotus - Current Court composition (per-seat justice + ideology leans, vacant seats included).
// Auth: requireBasicAuth
// Errors: 400, 401, 404
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getScotusComposition } from "@/lib/scotus/queries";

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Country not found" }, { status: 404 });
    }
    if (countryId !== "US") {
      // SCOTUS is US-only per #3581 scope.
      return NextResponse.json({ seats: [] });
    }

    const db = await getDb();
    const seats = await getScotusComposition(db, countryId);
    return NextResponse.json({ seats });
  } catch (error) {
    return handleRouteError(error);
  }
}
