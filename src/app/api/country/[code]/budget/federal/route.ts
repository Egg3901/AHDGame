// GET /api/country/[code]/budget/federal - Federal budget for a country.
// Auth: requireAuth
// Errors: 400, 404
//
// **Currency (v0.2.6):** All budget money fields are in the country's
// currency. Historical snapshots may lack `budget.currencyCode`, so the shared
// read model falls back to the country-derived display currency.
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getDb } from "@/lib/mongodb";
import { loadFederalBudgetDetail } from "@/lib/publicFinance/queries/federalBudgetDetail";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const db = await getDb();
    const detail = await loadFederalBudgetDetail({
      db,
      countryId,
      requestUrl: request.url,
      // Drives the Finance-Minister lens gate. Only the seated finance-minister-
      // equivalent of this country resolves to isFinanceMinister=true.
      characterId: auth.user.character?._id,
    });
    if (!detail.ok) {
      return NextResponse.json({ error: detail.error }, { status: detail.status });
    }

    return NextResponse.json(detail.body);
  } catch (error) {
    return handleRouteError(error);
  }
}
