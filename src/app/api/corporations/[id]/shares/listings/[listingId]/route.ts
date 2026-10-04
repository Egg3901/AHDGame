import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { cancelShareListingAndRefund } from "@/lib/corporations/cancelShareListing";
import type { ShareListing } from "@/lib/db/types";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";

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
    const turnGuard = await rejectDuringTurn(db);
    if (turnGuard) return turnGuard;
    const forexEnabled = await isForexEnabled();

    if (!ObjectId.isValid(listingId)) {
      return errorResponse(400, "Invalid listing ID");
    }

    const listing = await db
      .collection<ShareListing>("shareListings")
      .findOne({ _id: new ObjectId(listingId) });

    if (!listing) {
      return errorResponse(404, "Listing not found");
    }

    if (listing.status !== "open") {
      return errorResponse(400, "Listing is not open");
    }

    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return errorResponse(404, "Character not found");
    }

    if (listing.sellerCharacterId.toString() !== character._id.toString()) {
      return errorResponse(403, "Not your listing");
    }

    const result = await cancelShareListingAndRefund(db, listing, new Date(), forexEnabled);
    if (!result.ok) {
      if (result.rateUnavailable) {
        return errorResponse(503, result.error);
      }
      return errorResponse(400, result.error);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
