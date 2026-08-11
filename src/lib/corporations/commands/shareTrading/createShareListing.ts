import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { createListingSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { assertCeoTradeNotBlocked } from "@/lib/corporations/commands/privatization/openVoteGuard";
import {
  creditShares,
  creditSharesToCorp,
  debitShares,
  debitSharesFromCorp,
} from "@/lib/corporations/shareholderOps";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import type { Corporation, ShareListing, ShareOrder } from "@/lib/db/types";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { closeCeoTenure } from "@/lib/corporations/ceoHistory";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const LISTING_TTL_MS = 24 * 60 * 60 * 1000;
const LISTING_TTL_TURNS = 24; // 24 turns = 24h at standard cadence

function buildCeoRestoreUpdate(corporation: Corporation, now: Date) {
  const unsetFields: Record<string, ""> = {};
  if (corporation.ceoVacantSinceTurn === undefined) {
    unsetFields.ceoVacantSinceTurn = "";
  }
  if (!corporation.pendingCeoCharacterId) {
    unsetFields.pendingCeoCharacterId = "";
  }

  return {
    $set: {
      ceoId: corporation.ceoId,
      userId: corporation.userId,
      ceoVacant: corporation.ceoVacant ?? false,
      updatedAt: now,
      ...(corporation.ceoVacantSinceTurn !== undefined
        ? { ceoVacantSinceTurn: corporation.ceoVacantSinceTurn }
        : {}),
      ...(corporation.pendingCeoCharacterId
        ? { pendingCeoCharacterId: corporation.pendingCeoCharacterId }
        : {}),
    },
    ...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {}),
  };
}

/**
 * POST /api/corporations/[id]/shares/listings
 * Create a private share listing. Shares are reserved immediately (debited from holder).
 * Accounts for shares already reserved in open sell orders and open listings.
 */
export async function createShareListing(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, createListingSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { shares, sellAsCorporation, confirmCeoVacate } = parsed.data;
    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const tradeLock = await assertCeoTradeNotBlocked(db, corporation, character._id);
    if (tradeLock.blocked) {
      return NextResponse.json({ error: tradeLock.error }, { status: tradeLock.status });
    }

    const now = new Date();
    // Turn-based expiry anchor — set alongside the Date so listing expiry
    // freezes on pause (see ShareListing.expiresAtTurn).
    const nowTurn = await getCurrentTurn(db);

    if (sellAsCorporation) {
      const placerCorp = await db
        .collection<Corporation>("corporations")
        .findOne({ ceoId: character._id, ceoVacant: { $ne: true } });
      if (!placerCorp) {
        return NextResponse.json(
          { error: "You must be an active CEO to list shares on behalf of a corporation" },
          { status: 403 }
        );
      }
      if (placerCorp._id.equals(corporation._id)) {
        return NextResponse.json(
          { error: "A corporation cannot list its own shares" },
          { status: 400 }
        );
      }

      if (placerCorp.countryOwnerId) {
        return NextResponse.json(
          { error: "National corporations cannot hold equity positions" },
          { status: 400 }
        );
      }

      const shareholderEntry = corporation.shareholders?.find(
        (sh) => sh.corporationId?.toString() === placerCorp._id.toString()
      );
      const ownedShares = shareholderEntry?.shares ?? 0;

      const [openOrders, openListings] = await Promise.all([
        db
          .collection<ShareOrder>("shareOrders")
          .find({
            corporationId: corporation._id,
            placerCorporationId: placerCorp._id,
            type: "sell",
            status: "open",
          })
          .toArray(),
        db
          .collection<ShareListing>("shareListings")
          .find({
            corporationId: corporation._id,
            sellerCorporationId: placerCorp._id,
            status: "open",
            // Turn-first "still active" filter (matches the turn processor's
            // expiry) with a wall-clock fallback for legacy listings.
            $or: [
              { expiresAtTurn: { $gt: nowTurn } },
              { expiresAtTurn: { $exists: false }, expiresAt: { $gt: now } },
            ],
          })
          .toArray(),
      ]);
      const alreadyReserved =
        openOrders.reduce((s, o) => s + (o.sharesDebitedAtCreation ? 0 : o.sharesRemaining), 0) +
        openListings.reduce((s, l) => s + l.sharesRemaining, 0);
      const available = ownedShares - alreadyReserved;

      if (available < shares) {
        return NextResponse.json(
          { error: `Only ${available.toLocaleString()} shares available` },
          { status: 400 }
        );
      }

      const listingId = new ObjectId();
      const remainingAfterReserve = await debitSharesFromCorp(
        db,
        corporation._id,
        placerCorp._id,
        shares,
        {
          $set: { updatedAt: now },
        },
        { requireSufficient: true }
      );
      if (remainingAfterReserve < 0) {
        return NextResponse.json(
          { error: "Shares were already sold or reserved by another action" },
          { status: 409 }
        );
      }

      try {
        await db.collection<ShareListing>("shareListings").insertOne({
          _id: listingId,
          corporationId: corporation._id,
          sellerCharacterId: character._id,
          sellerCorporationId: placerCorp._id,
          sharesListed: shares,
          sharesRemaining: shares,
          marketPriceAtCreation: corporation.sharePrice,
          status: "open",
          createdAt: now,
          expiresAt: new Date(now.getTime() + LISTING_TTL_MS),
          expiresAtTurn: nowTurn + LISTING_TTL_TURNS,
        });
      } catch (error) {
        await creditSharesToCorp(
          db,
          corporation._id,
          placerCorp._id,
          shares,
          shareholderEntry?.avgCostPerShare ?? corporation.sharePrice,
          { $set: { updatedAt: new Date() } }
        );
        throw error;
      }

      return NextResponse.json({ success: true, sharesReserved: shares });
    }

    // Character listing their own shares
    const shareholderEntry = corporation.shareholders?.find(
      (sh) => sh.characterId?.toString() === character._id.toString()
    );
    const ownedShares = shareholderEntry?.shares ?? 0;

    const [openOrders, openListings] = await Promise.all([
      db
        .collection<ShareOrder>("shareOrders")
        .find({
          corporationId: corporation._id,
          characterId: character._id,
          type: "sell",
          status: "open",
        })
        .toArray(),
      db
        .collection<ShareListing>("shareListings")
        .find({
          corporationId: corporation._id,
          sellerCharacterId: character._id,
          status: "open",
          // Turn-first "still active" filter (matches the turn processor's
          // expiry) with a wall-clock fallback for legacy listings.
          $or: [
            { expiresAtTurn: { $gt: nowTurn } },
            { expiresAtTurn: { $exists: false }, expiresAt: { $gt: now } },
          ],
        })
        .toArray(),
    ]);
    const alreadyReserved =
      openOrders.reduce((s, o) => s + (o.sharesDebitedAtCreation ? 0 : o.sharesRemaining), 0) +
      openListings.reduce((s, l) => s + l.sharesRemaining, 0);
    const available = ownedShares - alreadyReserved;

    if (available < shares) {
      return NextResponse.json(
        { error: `Only ${available.toLocaleString()} shares available` },
        { status: 400 }
      );
    }

    // Listing every unreserved share removes the CEO's effective control immediately.
    const shouldVacateCeo = character._id.equals(corporation.ceoId) && available === shares;
    if (shouldVacateCeo && !confirmCeoVacate) {
      return NextResponse.json(
        {
          error: `You are the CEO of ${corporation.name}. Listing all ${shares.toLocaleString()} of your remaining shares will remove you as CEO — this can't be undone, and you'd have to be re-appointed to become CEO again.`,
          requiresCeoVacateConfirm: true,
        },
        { status: 409 }
      );
    }
    let corporationUpdate: {
      $set: { updatedAt: Date; ceoVacant?: boolean; ceoVacantSinceTurn?: number };
      $unset?: { ceoId: ""; userId: ""; pendingCeoCharacterId: "" };
    } = { $set: { updatedAt: now } };
    if (shouldVacateCeo) {
      const currentTurn = await getCurrentTurn(db);
      corporationUpdate = {
        $set: {
          ceoVacant: true,
          ceoVacantSinceTurn: currentTurn,
          updatedAt: now,
        },
        $unset: { ceoId: "", userId: "", pendingCeoCharacterId: "" },
      };
    }

    const listingId = new ObjectId();
    const remainingAfterReserve = await debitShares(
      db,
      corporation._id,
      character._id,
      shares,
      corporationUpdate,
      { requireSufficient: true }
    );
    if (remainingAfterReserve < 0) {
      return NextResponse.json(
        { error: "Shares were already sold or reserved by another action" },
        { status: 409 }
      );
    }

    let listingInserted = false;
    try {
      await db.collection<ShareListing>("shareListings").insertOne({
        _id: listingId,
        corporationId: corporation._id,
        sellerCharacterId: character._id,
        sharesListed: shares,
        sharesRemaining: shares,
        marketPriceAtCreation: corporation.sharePrice,
        status: "open",
        createdAt: now,
        expiresAt: new Date(now.getTime() + LISTING_TTL_MS),
        // Mirror the corp-listing path (line 194): set the turn anchor so
        // character listings freeze on pause and read/submit/expiry all agree.
        expiresAtTurn: nowTurn + LISTING_TTL_TURNS,
      });
      listingInserted = true;

      if (shouldVacateCeo) {
        await db.collection("corporationCeoVotes").deleteMany({
          corporationId: corporation._id,
        });
        await closeCeoTenure(db, corporation._id, {
          holderId: character._id,
          turn: await getCurrentTurn(db),
        });
      }
    } catch (error) {
      if (listingInserted) {
        await db.collection("shareListings").deleteOne({ _id: listingId });
      }

      await creditShares(
        db,
        corporation._id,
        character._id,
        shares,
        { $set: { updatedAt: new Date() } },
        {
          pricePerShare: shareholderEntry?.avgCostPerShare ?? corporation.sharePrice,
        }
      );

      if (shouldVacateCeo) {
        await db
          .collection<Corporation>("corporations")
          .updateOne({ _id: corporation._id }, buildCeoRestoreUpdate(corporation, new Date()));
      }

      throw error;
    }

    return NextResponse.json({ success: true, sharesReserved: shares });
  } catch (error) {
    return handleRouteError(error);
  }
}
