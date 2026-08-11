import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { cancelShareListingAndRefund } from "@/lib/corporations/cancelShareListing";
import type { ShareListing } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string; listingId: string }>;
}

/**
 * DELETE /api/corporations/[id]/shares/listings/[listingId]
 * Cancel an open listing. Returns reserved shares to seller; refunds all pending offer escrows.
 * Auth: requireBasicAuth — seller only
 * Errors: 400 (not open), 403 (not seller), 404 (not found), 429 (rate limited), 503 (FX unavailable)
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { listingId } = await params;
    const db = await getDb();
    const forexEnabled = await isForexEnabled();

    if (!ObjectId.isValid(listingId)) {
      return NextResponse.json({ error: "Invalid listing ID" }, { status: 400 });
    }

    const listing = await db
      .collection<ShareListing>("shareListings")
      .findOne({ _id: new ObjectId(listingId) });

    if (!listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    if (listing.status !== "open") {
      return NextResponse.json({ error: "Listing is not open" }, { status: 400 });
    }

    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    if (listing.sellerCharacterId.toString() !== character._id.toString()) {
      return NextResponse.json({ error: "Not your listing" }, { status: 403 });
    }

    const result = await cancelShareListingAndRefund(db, listing, new Date(), forexEnabled);
    if (!result.ok) {
      if (result.rateUnavailable) {
        return NextResponse.json({ error: result.error }, { status: 503 });
      }
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
