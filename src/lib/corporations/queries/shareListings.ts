import { NextResponse } from "next/server";
import type { ShareListing, ShareOffer } from "@/lib/db/types";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { bulkFetchCharacterNames, getCharacterByUserId } from "@/lib/db/characterLookup";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/corporations/[id]/shares/listings
 * Returns all open listings for this corporation, including their pending offers.
 */
export async function getShareListingsView(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const character = await getCharacterByUserId(db, auth.user.userId);
    const myCharacterId = character?._id.toString();

    const now = new Date();
    const nowTurn = await getCurrentTurn(db);
    const listings = await db
      .collection<ShareListing>("shareListings")
      .find({
        corporationId: corporation._id,
        status: "open",
        // Turn-first "still active" filter (matches the offer-submit guard, the
        // listing-reservation query, and the turn processor) with a wall-clock
        // fallback for legacy rows. A Date-only filter here hid listings whose
        // wall-clock expiry had passed but whose turn expiry had not (turns
        // slower than 1h, or paused) — buyers could still place offers via the
        // turn-first submit guard that the seller then never saw here.
        $or: [
          { expiresAtTurn: { $gt: nowTurn } },
          { expiresAtTurn: { $exists: false }, expiresAt: { $gt: now } },
        ],
      })
      .sort({ createdAt: -1 })
      .toArray();

    if (listings.length === 0) {
      return NextResponse.json({ listings: [] });
    }

    const listingIds = listings.map((listing) => listing._id);
    const offers = await db
      .collection<ShareOffer>("shareOffers")
      .find({ listingId: { $in: listingIds }, status: "pending" })
      .sort({ pricePerShare: -1, createdAt: 1 })
      .toArray();

    const charIds = [
      ...listings.map((listing) => listing.sellerCharacterId),
      ...offers.map((offer) => offer.buyerCharacterId),
    ];
    const charNameMap = await bulkFetchCharacterNames(db, charIds);

    const offersByListing = new Map<string, typeof offers>();
    for (const offer of offers) {
      const key = offer.listingId.toString();
      const list = offersByListing.get(key) ?? [];
      list.push(offer);
      offersByListing.set(key, list);
    }

    const result = listings.map((listing) => {
      const listingOffers = offersByListing.get(listing._id.toString()) ?? [];
      const sellerInfo = charNameMap.get(listing.sellerCharacterId.toString());
      const isMySelling = myCharacterId && listing.sellerCharacterId.toString() === myCharacterId;

      return {
        _id: listing._id.toString(),
        sellerCharacterId: listing.sellerCharacterId.toString(),
        sellerName: sellerInfo?.name ?? "Unknown",
        sellerSequentialId: sellerInfo?.sequentialId,
        sharesListed: listing.sharesListed,
        sharesRemaining: listing.sharesRemaining,
        marketPriceAtCreation: listing.marketPriceAtCreation,
        priceFloor: listing.marketPriceAtCreation * 0.5,
        priceCeiling: listing.marketPriceAtCreation * 2.0,
        expiresAt: listing.expiresAt,
        isMySelling: !!isMySelling,
        offerCount: listingOffers.length,
        offers: listingOffers.map((offer) => {
          const buyerInfo = charNameMap.get(offer.buyerCharacterId.toString());
          return {
            _id: offer._id.toString(),
            buyerCharacterId: offer.buyerCharacterId.toString(),
            buyerName: buyerInfo?.name ?? "Unknown",
            buyerSequentialId: buyerInfo?.sequentialId,
            shares: offer.shares,
            pricePerShare: offer.pricePerShare,
            escrowAmount: offer.escrowAmount,
            isMyOffer: myCharacterId ? offer.buyerCharacterId.toString() === myCharacterId : false,
            createdAt: offer.createdAt,
          };
        }),
      };
    });

    return NextResponse.json({ listings: result });
  } catch (error) {
    return handleRouteError(error);
  }
}
