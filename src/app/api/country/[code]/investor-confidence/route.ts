// GET /api/country/[code]/investor-confidence
// The country's investor-confidence index (baseline 70), for the founding-cost
// preview and the budget page. Public read. Errors: 400
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { readInvestorConfidence } from "@/lib/nationalization/investorConfidence";

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
    const investorConfidence = await readInvestorConfidence(db, countryId);
    return NextResponse.json({ investorConfidence });
  } catch (error) {
    return handleRouteError(error);
  }
}
