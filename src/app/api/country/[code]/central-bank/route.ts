import { NextResponse } from "next/server";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { loadCountryCentralBankDetail } from "@/lib/monetaryPolicy/queries/countryCentralBankDetail";

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json(notFound("Country not found").toJson(), { status: 404 });
    }

    const user = await getAuthUserWithCharacter();
    const result = await loadCountryCentralBankDetail({
      countryId,
      viewer: user
        ? {
            isAdmin: user.isAdmin === true,
            character: user.character ?? null,
          }
        : null,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result.body);
  } catch (error) {
    return handleRouteError(error);
  }
}
