import { NextResponse } from "next/server";
import {
  positionHoldingTerms,
  takeReservedHoldingShares,
} from "@/lib/corporations/rules/holdingTerms";
import { pendingStockTaxReceipt } from "@/lib/corporations/rules/stockTaxReceipt";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { acceptOfferSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { assertCeoTradeNotBlocked } from "@/lib/corporations/commands/privatization/openVoteGuard";
import {
  beginShareFillAttempt,
  buildShareFillFingerprint,
  collectShareFillAuditRows,
  insertShareFillAuditRows,
  restoreFailedShareFillClaim,
  settleShareFillAttempt,
  type ShareFillAuditPlan,
} from "./shareFillAudit";
import {
  executeShareFillMoneyFlow,
  personalBalanceField,
  type ShareFillMoneyPlan,
} from "./shareFillMoney";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { notifyHostileTakeoverThresholdIfEligible } from "@/lib/corporations/hostileTakeoverNotifications";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";
import type {
  Character,
  Corporation,
  Notification,
  ShareListing,
  ShareOffer,
} from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string; listingId: string; offerId: string }>;
}

/**
 * POST /api/corporations/[id]/shares/listings/[listingId]/offers/[offerId]/accept
 * Seller accepts an offer — full or partial. Transfers shares; refunds unaccepted escrow.
 * Auth: requireBasicAuth — listing seller only
 * Errors: 400 (not open/pending/expired, sharesToAccept > max), 403 (not seller), 404 (not found)
 */
export async function acceptShareOffer(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id, listingId, offerId } = await params;
    const parsed = await parseJsonBody(request, acceptOfferSchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);

    const { sharesToAccept } = parsed.data;
    const db = await getDb();
    const forexEnabled = await isForexEnabled();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;
    const turnGuard = await rejectDuringTurn(db);
    if (turnGuard) return turnGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    if (!ObjectId.isValid(listingId) || !ObjectId.isValid(offerId)) {
      return errorResponse(400, "Invalid ID");
    }

    const [listing, offer] = await Promise.all([
      db.collection<ShareListing>("shareListings").findOne({ _id: new ObjectId(listingId) }),
      db.collection<ShareOffer>("shareOffers").findOne({ _id: new ObjectId(offerId) }),
    ]);

    if (!listing) return errorResponse(404, "Listing not found");
    if (!listing.corporationId.equals(corporation._id)) {
      return errorResponse(404, "Listing not found");
    }
    if (!offer) return errorResponse(404, "Offer not found");
    if (listing.activeShareFillKey) {
      return errorResponse(409, "Listing settlement is in progress. Please refresh.");
    }
    if (listing.status !== "open") return errorResponse(400, "Listing is not open");
    if (offer.status !== "pending") return errorResponse(400, "Offer is not pending");
    if (!offer.listingId.equals(listing._id))
      return errorResponse(400, "Offer does not belong to this listing");
    // Turn-first expiry guard (matches the turn processor) with a Date fallback
    // for legacy listings — so a turn-expired listing can't accept offers during
    // a cron lag before the processor closes it.
    const listingExpired =
      typeof listing.expiresAtTurn === "number"
        ? (await getCurrentTurn(db)) >= listing.expiresAtTurn
        : new Date() >= listing.expiresAt;
    if (listingExpired) return errorResponse(400, "Listing has expired");

    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) return errorResponse(404, "Character not found");

    const tradeLock = await assertCeoTradeNotBlocked(db, corporation, character._id);
    if (tradeLock.blocked) {
      return errorResponse(tradeLock.status, tradeLock.error);
    }

    if (listing.sellerCharacterId.toString() !== character._id.toString()) {
      return errorResponse(403, "Only the seller can accept offers");
    }

    const maxAcceptable = Math.min(offer.shares, listing.sharesRemaining);
    if (sharesToAccept > maxAcceptable) {
      return errorResponse(400, `Cannot accept more than ${maxAcceptable.toLocaleString()} shares`);
    }

    const now = new Date();
    const currentTurn = await getCurrentTurn(db);
    const reserved = !listing.sellerCorporationId
      ? takeReservedHoldingShares(
          positionHoldingTerms(
            { shares: listing.sharesRemaining, holdingTerms: listing.holdingTerms },
            currentTurn,
            listing.marketPriceAtCreation
          ),
          sharesToAccept,
          currentTurn
        )
      : undefined;
    // offer.pricePerShare and offer.escrowAmount are both stored in the listing
    // corp's liquidCurrencyCode (Option B). proceeds + refund always equals
    // offer.escrowAmount exactly in local terms, so we compute both in local
    // and then hop through ₳ for the seller-credit / buyer-refund wallet math.
    const listingCorp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: listing.corporationId });
    const listingCorpFxRate = await getCorpFxRate(db, listingCorp ?? {});
    const proceedsLocal = sharesToAccept * offer.pricePerShare;
    const refundLocal = (offer.shares - sharesToAccept) * offer.pricePerShare;
    const proceeds =
      Math.round(
        corpLiquidCapitalToAnchor(proceedsLocal, listingCorp ?? {}, listingCorpFxRate) * 100
      ) / 100;
    const refund =
      Math.round(
        corpLiquidCapitalToAnchor(refundLocal, listingCorp ?? {}, listingCorpFxRate) * 100
      ) / 100;
    const sellerChar = !listing.sellerCorporationId
      ? await db
          .collection<Character>("characters")
          .findOne({ _id: listing.sellerCharacterId }, { projection: { countryId: 1, name: 1 } })
      : null;
    const sellerCurrency = sellerChar ? getHomeCurrency(sellerChar) : "USD";
    let sellerFxRate = 1.0;
    if (!listing.sellerCorporationId && forexEnabled) {
      const fxResult = await loadCharacterFxRate(db, sellerCurrency);
      if (!fxResult.ok) {
        return errorResponse(503, "Exchange rate unavailable for seller");
      }
      sellerFxRate = fxResult.rate;
    }

    const buyerCharForRefund = !offer.buyerCorporationId
      ? await db
          .collection<Character>("characters")
          .findOne({ _id: offer.buyerCharacterId }, { projection: { countryId: 1, name: 1 } })
      : null;
    const buyerCurrency = buyerCharForRefund ? getHomeCurrency(buyerCharForRefund) : "USD";
    let buyerFxRate = 1.0;
    if (refund > 0 && !offer.buyerCorporationId && forexEnabled) {
      const fxResult = await loadCharacterFxRate(db, buyerCurrency);
      if (!fxResult.ok) {
        return errorResponse(503, "Exchange rate unavailable for buyer");
      }
      buyerFxRate = fxResult.rate;
    }

    const [sellerCorp, buyerCorp, activation] = await Promise.all([
      listing.sellerCorporationId
        ? db.collection<Corporation>("corporations").findOne({ _id: listing.sellerCorporationId })
        : null,
      offer.buyerCorporationId
        ? db.collection<Corporation>("corporations").findOne({ _id: offer.buyerCorporationId })
        : null,
      db
        .collection<{ _id: string; stockHoldingTaxStartTurn?: number }>("gameState")
        .findOne({ _id: "current" }, { projection: { stockHoldingTaxStartTurn: 1 } }),
    ]);
    if (listing.sellerCorporationId ? !sellerCorp : !sellerChar)
      return errorResponse(404, "Seller not found");
    if (offer.buyerCorporationId ? !buyerCorp : !buyerCharForRefund)
      return errorResponse(404, "Buyer not found");
    const sellerId = listing.sellerCorporationId ?? listing.sellerCharacterId;
    const buyerId = offer.buyerCorporationId ?? offer.buyerCharacterId;
    const sellerAmount = sellerCorp
      ? anchorToCorpLiquidCapital(proceeds, sellerCorp, await getCorpFxRate(db, sellerCorp))
      : proceeds * sellerFxRate;
    const buyerRefundAmount = buyerCorp
      ? anchorToCorpLiquidCapital(refund, buyerCorp, await getCorpFxRate(db, buyerCorp))
      : refund * buyerFxRate;
    const sellerCcy = sellerCorp
      ? (resolveCorpLiquidCurrencyCode(sellerCorp) ?? "USD")
      : sellerCurrency;
    const buyerCcy = buyerCorp
      ? (resolveCorpLiquidCurrencyCode(buyerCorp) ?? "USD")
      : buyerCurrency;
    const stockTax =
      !sellerCorp &&
      activation?.stockHoldingTaxStartTurn !== undefined &&
      currentTurn >= activation.stockHoldingTaxStartTurn
        ? pendingStockTaxReceipt({
            id: offer._id.toHexString(),
            currencyCode: sellerCcy,
            holdingTerms: reserved!.taken,
            proceedsAnchor: proceeds,
            proceedsCredited: sellerAmount,
            saleTurn: currentTurn,
            assessmentTurn: currentTurn + 1,
          })
        : undefined;
    const moneyPlan: ShareFillMoneyPlan = {
      version: 1,
      fillKey: "",
      orderIdHex: listing._id.toHexString(),
      corpIdHex: listing.corporationId.toHexString(),
      direction: "listing-fill",
      shares: sharesToAccept,
      turn: currentTurn,
      nowIso: now.toISOString(),
      fillerDebit: null,
      fillerCredit: null,
      sellerDebit: null,
      fundInventoryDebit: null,
      buyerHoldingsCredit: null,
      buyerCredit: {
        field: buyerCorp ? "corporationId" : "characterId",
        idHex: buyerId.toHexString(),
        pricePerShare: buyerCorp ? offer.pricePerShare : proceeds / sharesToAccept,
        ...(!buyerCorp ? { holdingTurn: currentTurn } : {}),
      },
      sellerProceeds: {
        collection: sellerCorp ? "corporations" : "characters",
        idHex: sellerId.toHexString(),
        field: sellerCorp ? "liquidCapital" : personalBalanceField(sellerCcy, forexEnabled),
        amount: sellerAmount,
        ...(stockTax ? { stockTaxReceipt: stockTax } : {}),
      },
      ...(buyerRefundAmount > 0
        ? {
            buyerRefund: {
              collection: buyerCorp ? ("corporations" as const) : ("characters" as const),
              idHex: buyerId.toHexString(),
              field: buyerCorp ? "liquidCapital" : personalBalanceField(buyerCcy, forexEnabled),
              amount: buyerRefundAmount,
            },
          }
        : {}),
    };
    const plan: ShareFillAuditPlan = {
      version: 1,
      targetKind: "listing",
      offerIdHex: offer._id.toHexString(),
      listingMoneyPlan: moneyPlan,
      orderIdHex: listing._id.toHexString(),
      corpIdHex: listing.corporationId.toHexString(),
      corpCcy: listingCorp?.liquidCurrencyCode,
      orderType: "sell",
      shares: sharesToAccept,
      pricePerShare: offer.pricePerShare,
      totalAnchor: proceeds,
      turn: currentTurn,
      nowIso: now.toISOString(),
      preClaimRemaining: listing.sharesRemaining,
      claimSnapshot: {
        escrowAmount: 0,
        holdingTerms: listing.holdingTerms,
        previousFillKey: listing.lastShareFillKey,
      },
      filler: {
        idHex: buyerId.toHexString(),
        collection: buyerCorp ? "corporations" : "characters",
        name: buyerCorp?.name ?? buyerCharForRefund!.name,
        homeCurrency: buyerCcy,
        imperial: false,
      },
      fillerAmount: proceeds,
      placerKind: sellerCorp ? "corporation" : "character",
      placerIdHex: sellerId.toHexString(),
      placerName: sellerCorp?.name ?? sellerChar!.name,
      sellerAmount,
      sellerCurrency: sellerCcy,
      fundTx: false,
      moneyCommitted: false,
      ...(stockTax ? { stockTax } : {}),
      ...(buyerRefundAmount > 0
        ? { buyerRefund: { amount: buyerRefundAmount, currency: buyerCcy } }
        : {}),
    };
    const fillKey = await beginShareFillAttempt(
      db,
      plan,
      buildShareFillFingerprint({
        orderId: listing._id,
        fillerId: buyerId,
        shares: sharesToAccept,
        pricePerShare: offer.pricePerShare,
      })
    );
    const listingSharesRemaining = listing.sharesRemaining - sharesToAccept;
    const listingUpdate = await db.collection<ShareListing>("shareListings").findOneAndUpdate(
      {
        _id: listing._id,
        sharesRemaining: listing.sharesRemaining,
        status: "open",
        activeShareFillKey: { $exists: false },
        ...(listing.holdingTerms
          ? { holdingTerms: listing.holdingTerms }
          : { holdingTerms: { $exists: false } }),
      },
      {
        $set: {
          sharesRemaining: listingSharesRemaining,
          status: listingSharesRemaining === 0 ? "filled" : "open",
          activeShareFillKey: fillKey,
          lastShareFillKey: fillKey,
          updatedAt: now,
          ...(reserved && listing.holdingTerms ? { holdingTerms: reserved.remaining } : {}),
        },
      },
      { returnDocument: "after" }
    );
    if (!listingUpdate) {
      await restoreFailedShareFillClaim(db, fillKey);
      await settleShareFillAttempt(db, fillKey, "failed", "listing:claim-lost");
      return errorResponse(409, "Listing changed before this acceptance could be applied");
    }
    const claimedOffer = await db
      .collection<ShareOffer>("shareOffers")
      .findOneAndUpdate(
        { _id: offer._id, status: "pending" },
        { $set: { status: "accepted", acceptFillKey: fillKey } },
        { returnDocument: "before" }
      );
    if (!claimedOffer) {
      await restoreFailedShareFillClaim(db, fillKey);
      await settleShareFillAttempt(db, fillKey, "failed", "listing:offer-claim-lost");
      return errorResponse(409, "Offer changed before this acceptance could be applied");
    }
    await executeShareFillMoneyFlow(db, moneyPlan);
    const audit = await insertShareFillAuditRows(db, fillKey, collectShareFillAuditRows(plan));
    if (audit !== "failed") await settleShareFillAttempt(db, fillKey, "completed");

    // Notify buyer
    const buyerChar = await db
      .collection<Character>("characters")
      .findOne({ _id: offer.buyerCharacterId }, { projection: { userId: 1 } });

    if (buyerChar) {
      const listingCorpSym =
        CURRENCY_SYMBOLS[(listingCorp?.liquidCurrencyCode ?? "USD") as CurrencyCode] ?? "₳";
      void db
        .collection<Omit<Notification, "_id">>("notifications")
        .insertOne({
          userId: buyerChar.userId,
          type: "share_offer_accepted",
          title: "Your share offer was accepted",
          message: `${sharesToAccept.toLocaleString()} shares of ${listingCorp?.name ?? "unknown"} at ${listingCorpSym}${offer.pricePerShare.toFixed(4)}/share`,
          read: false,
          metadata: { listingId: listing._id.toString(), offerId: offer._id.toString() },
          createdAt: now,
        } as Omit<Notification, "_id">)
        .catch(() => undefined);
    }

    void notifyHostileTakeoverThresholdIfEligible(db, listing.corporationId);

    return NextResponse.json({
      success: true,
      sharesTransferred: sharesToAccept,
      proceeds,
      refundedToOffer: refund,
      listingSharesRemaining,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
