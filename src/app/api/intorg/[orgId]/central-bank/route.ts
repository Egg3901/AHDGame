import { NextResponse } from "next/server";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { loadCountryCentralBankDetail } from "@/lib/monetaryPolicy/queries/countryCentralBankDetail";
import { resolveIntorgCentralBankCountry, type IntorgRouteContext } from "./_helpers";

export async function GET(request: Request, context: IntorgRouteContext) {
  try {
    const resolved = await resolveIntorgCentralBankCountry(context);
    if ("response" in resolved) return resolved.response;

    const user = await getAuthUserWithCharacter();
    const result = await loadCountryCentralBankDetail({
      countryId: resolved.countryId,
      viewer: user
        ? {
            isAdmin: user.isAdmin === true,
            character: user.character ?? null,
          }
        : null,
    });

    if (!result.ok) {
      return errorResponse(result.status, result.error);
    }

    return NextResponse.json(result.body);
  } catch (error) {
    return handleRouteError(error);
  }
}
