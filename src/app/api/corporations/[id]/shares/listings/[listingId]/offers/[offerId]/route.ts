import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  buildPersonalBalanceInc,
  getHomeCurrency,
  loadCharacterFxRate,
} from "@/lib/currency/characterFunds";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { emitTx } from "@/lib/financialTxLog/emit";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import type { Character, Corporation, ShareOffer } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string; listingId: string; offerId: string }>;
}

async function restoreOfferToPending(db: Awaited<ReturnType<typeof getDb>>, offerId: ObjectId) {
  await db
    .collection<ShareOffer>("shareOffers")
    .updateOne(
      { _id: offerId, status: "cancelled" },
      { $set: { status: "pending", updatedAt: new Date() } }
    );
}

/**
 * DELETE /api/corporations/[id]/shares/listings/[listingId]/offers/[offerId]
 * Withdraw a pending offer. Full escrow refunded immediately.
 * Auth: requireBasicAuth — offer owner only
 * Errors: 400 (not pending), 403 (not your offer), 404 (not found)
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { offerId } = await params;
    const db = await getDb();
    const forexEnabled = await isForexEnabled();

    if (!ObjectId.isValid(offerId)) {
      return NextResponse.json({ error: "Invalid offer ID" }, { status: 400 });
    }

    const offer = await db
      .collection<ShareOffer>("shareOffers")
      .findOne({ _id: new ObjectId(offerId) });

    if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 });
    if (offer.status !== "pending")
      return NextResponse.json({ error: "Offer is not pending" }, { status: 400 });

    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) return NextResponse.json({ error: "Character not found" }, { status: 404 });

    if (offer.buyerCharacterId.toString() !== character._id.toString()) {
      return NextResponse.json({ error: "Not your offer" }, { status: 403 });
    }

    const now = new Date();

    // Refund escrow. offer.escrowAmount is in the LISTING corp's liquidCurrencyCode
    // (Option B); normalize to ₳ via the listing corp's FX, then hop to whatever
    // party the refund lands in.
    const listingCorp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: offer.corporationId });
    const listingCorpFxRate = await getCorpFxRate(db, listingCorp ?? {});
    const refundAnchor = corpLiquidCapitalToAnchor(
      offer.escrowAmount,
      listingCorp ?? {},
      listingCorpFxRate
    );
    const currentTurn = await getCurrentTurn(db);

    if (offer.buyerCorporationId) {
      const buyerCorp = await db
        .collection<Corporation>("corporations")
        .findOne({ _id: offer.buyerCorporationId });
      const buyerFxRate = await getCorpFxRate(db, buyerCorp ?? {});
      const refundInBuyerCapital = anchorToCorpLiquidCapital(
        refundAnchor,
        buyerCorp ?? {},
        buyerFxRate
      );
      const claim = await db
        .collection<ShareOffer>("shareOffers")
        .updateOne(
          { _id: offer._id, status: "pending" },
          { $set: { status: "cancelled", updatedAt: now } }
        );
      if (claim.matchedCount === 0) {
        return NextResponse.json({ error: "Offer is not pending" }, { status: 400 });
      }
      let refundCredited = false;
      try {
        const refundResult = await db
          .collection<Corporation>("corporations")
          .updateOne(
            { _id: offer.buyerCorporationId },
            { $inc: { liquidCapital: refundInBuyerCapital }, $set: { updatedAt: now } }
          );
        if (refundResult.matchedCount === 0) {
          throw new Error("Buyer corporation not found");
        }
        refundCredited = true;
        await emitTx(db, {
          type: "share_listing_refund",
          turn: currentTurn,
          createdAt: now,
          subjectType: "corporation",
          subjectId: offer.buyerCorporationId,
          subjectName: buyerCorp?.name ?? "(unknown)",
          amount: Math.round(refundInBuyerCapital * 100) / 100,
          currencyCode: resolveCorpLiquidCurrencyCode(buyerCorp) ?? "USD",
          counterpartyType: "system",
          counterpartyName: "Private listing escrow",
          meta: {
            listingId: offer.listingId.toString(),
            offerId: offer._id.toString(),
            corporationId: offer.corporationId.toString(),
            shares: offer.shares,
            pricePerShare: offer.pricePerShare,
            reason: "offer_withdrawn",
          },
        });
      } catch (error) {
        if (refundCredited) {
          await db
            .collection<Corporation>("corporations")
            .updateOne(
              { _id: offer.buyerCorporationId },
              { $inc: { liquidCapital: -refundInBuyerCapital }, $set: { updatedAt: new Date() } }
            );
        }
        await restoreOfferToPending(db, offer._id);
        throw error;
      }
    } else {
      const homeCurrency = getHomeCurrency(character);
      let charFxRate = 1.0;
      if (forexEnabled) {
        const fxResult = await loadCharacterFxRate(db, homeCurrency);
        if (!fxResult.ok) {
          return NextResponse.json(
            { error: "Exchange rate unavailable, try again shortly" },
            { status: 503 }
          );
        }
        charFxRate = fxResult.rate;
      }
      const refundInHome = refundAnchor * charFxRate;
      const claim = await db
        .collection<ShareOffer>("shareOffers")
        .updateOne(
          { _id: offer._id, status: "pending" },
          { $set: { status: "cancelled", updatedAt: now } }
        );
      if (claim.matchedCount === 0) {
        return NextResponse.json({ error: "Offer is not pending" }, { status: 400 });
      }
      let refundCredited = false;
      try {
        const refundResult = await db.collection<Character>("characters").updateOne(
          { _id: character._id },
          {
            $inc: buildPersonalBalanceInc(refundInHome, homeCurrency, forexEnabled),
            $set: { updatedAt: now },
          }
        );
        if (refundResult.matchedCount === 0) {
          throw new Error("Buyer character not found");
        }
        refundCredited = true;
        await emitTx(db, {
          type: "share_listing_refund",
          turn: currentTurn,
          createdAt: now,
          subjectType: "character",
          subjectId: character._id,
          subjectName: character.name,
          amount: Math.round(refundInHome * 100) / 100,
          currencyCode: homeCurrency,
          counterpartyType: "system",
          counterpartyName: "Private listing escrow",
          meta: {
            listingId: offer.listingId.toString(),
            offerId: offer._id.toString(),
            corporationId: offer.corporationId.toString(),
            shares: offer.shares,
            pricePerShare: offer.pricePerShare,
            reason: "offer_withdrawn",
          },
        });
      } catch (error) {
        if (refundCredited) {
          await db.collection<Character>("characters").updateOne(
            { _id: character._id },
            {
              $inc: buildPersonalBalanceInc(-refundInHome, homeCurrency, forexEnabled),
              $set: { updatedAt: new Date() },
            }
          );
        }
        await restoreOfferToPending(db, offer._id);
        throw error;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
