import { NextResponse } from "next/server";
import { COUNTRY_CONFIGS, type CountryId, isParliamentarySystem } from "@/lib/constants/countries";
import { getCabinetCharactersHandler } from "@/lib/uk/cabinetApi";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[countryId];

  if (!config || !isParliamentarySystem(config)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return getCabinetCharactersHandler(request, countryId);
}
