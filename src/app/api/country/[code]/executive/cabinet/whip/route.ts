import { errorResponse } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId, isParliamentarySystem } from "@/lib/constants/countries";
import { getWhipWithdrawnHandler } from "@/lib/uk/cabinetApi";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[countryId];

  if (!config || !isParliamentarySystem(config)) {
    return errorResponse(404, "Not found");
  }

  return getWhipWithdrawnHandler(request, countryId);
}
