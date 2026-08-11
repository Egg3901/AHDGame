// GET /api/country/[code]/central-bank/loc - Prime, currency, and LOC snapshot for a central-bank loan page.
// Auth: requireBasicAuth
// Errors: 401, 404
import { NextResponse } from "next/server";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getDb } from "@/lib/mongodb";
import { loadCountryCentralBankLoc } from "@/lib/monetaryPolicy/queries/countryCentralBankLoc";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Country not found" }, { status: 404 });
    }

    const db = await getDb();
    const detail = await loadCountryCentralBankLoc({
      db,
      countryId,
      userId: auth.user.userId,
      isAdmin: auth.user.isAdmin === true,
    });
    if (!detail.ok) {
      return NextResponse.json({ error: detail.error }, { status: detail.status });
    }

    return NextResponse.json(detail.body);
  } catch (error) {
    return handleRouteError(error);
  }
}
