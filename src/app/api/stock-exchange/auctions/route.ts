// GET /api/stock-exchange/auctions?exchange=<apiKey|global>
// Open privatization auctions for the Stock Market "Auctions" tab. The global
// exchange aggregates every country's open auctions; a specific exchange key
// scopes to that country. Public read; an optional viewer adds viewerCountryId
// so the client can flag which auctions the viewer may bid on (residents only).
// Auth: public read (optional viewer). Errors: 400
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { handleRouteError } from "@/lib/api/errors";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { buildAuctionListings } from "@/lib/nationalization/auctionListing";
import { EXCHANGE_API_KEYS, getCountryForExchange } from "@/lib/constants/exchangeRegistry";

export async function GET(request: Request) {
  try {
    const exchange = new URL(request.url).searchParams.get("exchange")?.toLowerCase() ?? "global";

    // "global" aggregates all countries; any other key must be a known exchange.
    let countryId: ReturnType<typeof getCountryForExchange>;
    if (exchange !== "global") {
      if (!EXCHANGE_API_KEYS.has(exchange)) {
        return NextResponse.json(
          {
            error: `Invalid exchange. Use "global" or one of: ${[...EXCHANGE_API_KEYS].join(", ")}`,
          },
          { status: 400 }
        );
      }
      countryId = getCountryForExchange(exchange);
    }

    const db = await getDb();
    const currentTurn = await getCurrentTurn(db);
    const auctions = await buildAuctionListings(db, {
      currentTurn,
      ...(countryId ? { countryId } : {}),
    });

    // Optional viewer → their country, so the client can flag biddable rows.
    const authUser = await getAuthUser().catch(() => null);
    const viewer = authUser
      ? await getCharacterByUserId(db, authUser.userId).catch(() => null)
      : null;
    const viewerCountryId = viewer?.countryId ?? null;

    return NextResponse.json({ currentTurn, auctions, viewerCountryId });
  } catch (error) {
    return handleRouteError(error);
  }
}
