// GET /api/country/[code]/scotus/cases - History of past Docket cases and their outcomes (affirmed/diverged).
// Auth: requireBasicAuth
// Errors: 400, 401, 404
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getScotusCaseHistory } from "@/lib/scotus/queries";

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Country not found" }, { status: 404 });
    }
    if (countryId !== "US") {
      return NextResponse.json({ cases: [] });
    }

    const preset = new URL(request.url).searchParams.get("preset") ?? undefined;
    const db = await getDb();
    const cases = await getScotusCaseHistory(db, countryId, preset);
    return NextResponse.json({ cases });
  } catch (error) {
    return handleRouteError(error);
  }
}
