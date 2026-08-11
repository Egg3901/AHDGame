// GET /api/country/[code]/nationalization-auctions
// Open privatization auctions for the country (spec §13.3) for the public auctions
// marketplace. Optional auth adds the viewer's biddable corporations. Bidding goes
// through POST /api/corporations/[id]/nationalization-auction/bid.
// Auth: public read (optional viewer for biddable-corp list)
// Errors: 400
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { verifyAuth } from "@/lib/auth";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import type { Corporation } from "@/lib/db/types";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { buildAuctionListings } from "@/lib/nationalization/auctionListing";
import { isForexEnabled } from "@/lib/currency/featureFlag";

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const db = await getDb();
    const currentTurn = await getCurrentTurn(db);

    const auctions = await buildAuctionListings(db, { currentTurn, countryId });

    // Optional viewer → corps they may bid on behalf of (CEO, not vacant).
    const authUser = await verifyAuth().catch(() => null);
    const viewer = authUser
      ? await getCharacterByUserId(db, authUser.userId).catch(() => null)
      : null;
    // Bidding is residency-gated (spec §13.3): only residents of the auction's
    // country may bid. Auctions stay visible to everyone (transparency); the UI
    // mirrors this flag, the server bid route is authoritative.
    const viewerIsResident = viewer ? viewer.countryId === countryId : false;

    // Viewer's available cash in the country's currency, resolved the same way the
    // bid debit reads it (forex → currencyBalances.personal.<code>; else cashOnHand),
    // so the UI hint matches what the server will actually allow.
    const forexEnabled = await isForexEnabled();
    const countryCurrency = (COUNTRY_CURRENCY_MAP[countryId] ?? "USD") as CurrencyCode;
    const viewerPersonalBalance = viewer
      ? forexEnabled
        ? (viewer.currencyBalances?.personal?.[countryCurrency] ?? 0)
        : (viewer.cashOnHand ?? 0)
      : null;

    let viewerCorporations: Array<{
      id: string;
      name: string;
      currency: CurrencyCode;
      liquidCapital: number;
    }> = [];
    if (viewer) {
      const myCorps = await db
        .collection<Corporation>("corporations")
        .find({ ceoId: viewer._id, ceoVacant: { $ne: true } })
        .project<{
          _id: Corporation["_id"];
          name: string;
          liquidCurrencyCode?: CurrencyCode;
          liquidCapital?: number;
        }>({ _id: 1, name: 1, liquidCurrencyCode: 1, liquidCapital: 1 })
        .toArray();
      viewerCorporations = myCorps.map((c) => ({
        id: String(c._id),
        name: c.name,
        currency: (c.liquidCurrencyCode ?? "USD") as CurrencyCode,
        liquidCapital: Math.round(c.liquidCapital ?? 0),
      }));
    }

    return NextResponse.json({
      currentTurn,
      auctions,
      viewerCorporations,
      viewerIsResident,
      viewerPersonalBalance,
      viewerCharacterId: viewer ? String(viewer._id) : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
