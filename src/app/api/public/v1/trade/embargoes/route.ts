import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { publicError } from "@/lib/publicApi/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryTradeEmbargoes } from "@/lib/publicApi/trade";

// GET /api/public/v1/trade/embargoes?country=CODE&includePending=true
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "trade-embargoes");
    if (!guard.ok) return guard.response;
    const search = new URL(request.url).searchParams;
    const countryParam = search.get("country");
    const country = countryParam?.toUpperCase() as CountryId | undefined;
    if (country && !COUNTRY_CONFIGS[country]) {
      return publicError("INVALID_COUNTRY", "Invalid country code", 400);
    }
    const includePendingParam = search.get("includePending");
    if (includePendingParam && includePendingParam !== "true" && includePendingParam !== "false") {
      return publicError("BAD_REQUEST", "includePending must be true or false", 400);
    }
    const result = await queryTradeEmbargoes(await getDb(), {
      country,
      includePending: includePendingParam === "true",
    });
    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
