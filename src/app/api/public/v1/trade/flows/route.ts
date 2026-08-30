import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getDb } from "@/lib/mongodb";
import { publicError } from "@/lib/publicApi/errors";
import {
  PUBLIC_HISTORY_DEFAULT_POINTS,
  PUBLIC_HISTORY_MAX_POINTS,
  queryTradeFlowHistory,
} from "@/lib/publicApi/history";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { parseBoundedInt } from "@/lib/publicApi/params";

const MAX_TURN = 1_000_000_000;

// GET /api/public/v1/trade/flows?country=&commodity=&fromTurn=&toTurn=&limit=
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "trade-flows");
    if (!guard.ok) return guard.response;

    const search = new URL(request.url).searchParams;
    const countryParam = search.get("country");
    const country = countryParam?.toUpperCase() as CountryId | undefined;
    if (country && !COUNTRY_CONFIGS[country]) {
      return publicError("INVALID_COUNTRY", "Invalid country code", 400);
    }
    const commodityParam = search.get("commodity");
    if (
      commodityParam &&
      !(COMMODITY_TYPES as readonly string[]).includes(commodityParam)
    ) {
      return publicError("BAD_REQUEST", "Invalid commodity key", 400);
    }

    const fromTurn = parseBoundedInt(search.get("fromTurn"), {
      name: "fromTurn",
      defaultValue: 0,
      min: 0,
      max: MAX_TURN,
    });
    const toTurn = parseBoundedInt(search.get("toTurn"), {
      name: "toTurn",
      defaultValue: MAX_TURN,
      min: 0,
      max: MAX_TURN,
    });
    const limit = parseBoundedInt(search.get("limit"), {
      name: "limit",
      defaultValue: PUBLIC_HISTORY_DEFAULT_POINTS,
      min: 1,
      max: PUBLIC_HISTORY_MAX_POINTS,
    });
    if (!fromTurn.ok) return publicError("BAD_REQUEST", fromTurn.message, 400);
    if (!toTurn.ok) return publicError("BAD_REQUEST", toTurn.message, 400);
    if (!limit.ok) return publicError("BAD_REQUEST", limit.message, 400);
    if (fromTurn.value > toTurn.value) {
      return publicError("BAD_REQUEST", "fromTurn must not exceed toTurn", 400);
    }

    const result = await queryTradeFlowHistory(await getDb(), {
      country,
      commodity: (commodityParam as CommodityType | null) ?? undefined,
      fromTurn: search.has("fromTurn") ? fromTurn.value : undefined,
      toTurn: search.has("toTurn") ? toTurn.value : undefined,
      limit: limit.value,
    });
    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
