import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { getAuthUser } from "@/lib/auth";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import type { MarketCapHistory } from "@/lib/db/types";
import { EXCHANGE_API_KEYS, getCountryForExchange } from "@/lib/constants/exchangeRegistry";
import { conditionalJson } from "@/lib/api/conditionalJson";

/**
 * GET /api/stock-exchange/market-cap-history?exchange=global|nyse|ftse|nikkei|...&sector=financial&limit=500
 * Returns market cap history for charting on the stock market page.
 */
export async function GET(request: Request) {
  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const exchange = searchParams.get("exchange")?.toLowerCase() ?? "global";
    const sector = searchParams.get("sector");
    const limit = Math.min(Number(searchParams.get("limit")) || 200, 2000);

    if (!EXCHANGE_API_KEYS.has(exchange)) {
      return NextResponse.json(
        { error: `Invalid exchange. Use one of: ${[...EXCHANGE_API_KEYS].join(", ")}` },
        { status: 400 }
      );
    }

    // Filter by country access
    const authUser = await getAuthUser();
    const isAdmin = authUser?.isAdmin === true;
    if (!isAdmin) {
      const enabledCountries = await getEnabledCountryIds();
      const requiredCountry = getCountryForExchange(exchange);
      if (requiredCountry && !enabledCountries.includes(requiredCountry)) {
        return NextResponse.json({ exchange, sector, points: [], newestTurnDate: null });
      }
    }

    const history = await db
      .collection<MarketCapHistory>("marketCapHistory")
      .find({})
      .sort({ turn: -1 })
      .limit(limit)
      .toArray();

    // Capture newest record date before reversing (history[0] is most recent at this point)
    const newestTurnDate = history.length > 0 ? history[0].createdAt.toISOString() : null;

    // Reverse to chronological order
    history.reverse();

    const points = history.map((h) => {
      let marketCap: number;
      let high: number | undefined;
      let low: number | undefined;
      if (exchange === "global") {
        marketCap = h.globalMarketCap;
        high = h.globalHigh;
        low = h.globalLow;
      } else {
        // Prefer new exchangeCaps format, fall back to legacy named fields
        const exData = h.exchangeCaps?.[exchange];
        if (exData) {
          marketCap = exData.marketCap;
          high = exData.high;
          low = exData.low;
        } else {
          // Legacy fallback for pre-migration data
          const LEGACY: Record<string, { cap: number; high?: number; low?: number }> = {
            nyse: { cap: h.nyseMarketCap, high: h.nyseHigh, low: h.nyseLow },
            ftse: { cap: h.ftseMarketCap, high: h.ftseHigh, low: h.ftseLow },
          };
          const legacy = LEGACY[exchange];
          marketCap = legacy?.cap ?? 0;
          high = legacy?.high;
          low = legacy?.low;
        }
      }

      // If filtering by sector, use sector-specific value (no stored spread for sectors)
      if (sector && h.bySector) {
        marketCap = h.bySector[sector as keyof typeof h.bySector] ?? 0;
        high = undefined;
        low = undefined;
      }

      return {
        turn: h.turn,
        marketCap,
        high,
        low,
        // Include sector breakdown for the chart filter
        bySector: h.bySector,
      };
    });

    // Per-user (filtered by enabled-country access) so it must not be shared-
    // cached; ETag/304 cuts egress when the history is unchanged between turns.
    return conditionalJson(request, { exchange, sector, points, newestTurnDate });
  } catch (error) {
    return handleRouteError(error);
  }
}
