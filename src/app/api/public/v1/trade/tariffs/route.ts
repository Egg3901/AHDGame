import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { publicError } from "@/lib/publicApi/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { parseBoundedInt } from "@/lib/publicApi/params";
import { PUBLIC_TARIFF_SCOPES, queryTariffs } from "@/lib/publicApi/trade";
import type { TariffScopeType } from "@/lib/db/types/tariff";

function parseCountry(value: string | null): CountryId | undefined | null {
  if (!value) return undefined;
  const country = value.toUpperCase() as CountryId;
  return COUNTRY_CONFIGS[country] ? country : null;
}

// GET /api/public/v1/trade/tariffs?country=CODE&targetCountry=CODE&scope=SCOPE&limit=N
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "trade-tariffs");
    if (!guard.ok) return guard.response;
    const search = new URL(request.url).searchParams;
    const country = parseCountry(search.get("country"));
    const targetCountry = parseCountry(search.get("targetCountry"));
    if (country === null || targetCountry === null) {
      return publicError("INVALID_COUNTRY", "Invalid country code", 400);
    }
    const scopeParam = search.get("scope");
    if (
      scopeParam &&
      !(PUBLIC_TARIFF_SCOPES as readonly string[]).includes(scopeParam)
    ) {
      return publicError("BAD_REQUEST", "Invalid tariff scope", 400);
    }
    const limit = parseBoundedInt(search.get("limit"), {
      name: "limit",
      defaultValue: 100,
      min: 1,
      max: 200,
    });
    if (!limit.ok) return publicError("BAD_REQUEST", limit.message, 400);
    const result = await queryTariffs(await getDb(), {
      country,
      targetCountry,
      scope: (scopeParam as TariffScopeType | null) ?? undefined,
      limit: limit.value,
    });
    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
