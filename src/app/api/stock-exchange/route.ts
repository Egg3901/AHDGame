import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { StockExchangeSnapshot } from "@/lib/db/types";
import { EXCHANGE_API_KEYS, getExchangeLabel } from "@/lib/constants/exchangeRegistry";

/**
 * GET /api/stock-exchange?exchange=nyse|ftse|nikkei|tsx|dax|global
 * Returns pre-computed stock exchange data from the snapshot collection.
 * Snapshots are rebuilt each turn and refreshed every five minutes for intraday float/price.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const exchange = searchParams.get("exchange")?.toLowerCase();

    if (!exchange || !EXCHANGE_API_KEYS.has(exchange)) {
      return NextResponse.json(
        { error: `Invalid exchange. Use one of: ${[...EXCHANGE_API_KEYS].join(", ")}` },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Read from pre-computed snapshot (single document read)
    const snapshot = await db
      .collection<StockExchangeSnapshot>("stockExchangeSnapshots")
      .findOne({ _id: exchange });

    if (!snapshot) {
      // Fallback: return empty listings if snapshot doesn't exist yet
      // (e.g., before first turn processing after deployment)
      return NextResponse.json({
        exchange: exchange.toUpperCase(),
        exchangeName: getExchangeLabel(exchange),
        listings: [],
        unlistedPrivateCount: 0,
        turn: 0,
      });
    }

    const response = NextResponse.json({
      exchange: exchange.toUpperCase(),
      exchangeName: snapshot.exchangeName,
      listings: snapshot.listings,
      unlistedPrivateCount: snapshot.unlistedPrivateCount ?? 0,
      turn: snapshot.turn,
    });

    // Short CDN TTL: snapshots refresh every 5m between turns; keep edge fresher than the old hourly model.
    response.headers.set("Cache-Control", "s-maxage=120, stale-while-revalidate=300, no-transform");
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
