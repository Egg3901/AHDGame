import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { acceptOfferSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { assertCeoTradeNotBlocked } from "@/lib/corporations/commands/privatization/openVoteGuard";
import {
  creditShares,
  creditSharesToCorp,
  debitShares,
  debitSharesFromCorp,
} from "@/lib/corporations/shareholderOps";
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
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { notifyHostileTakeoverThresholdIfEligible } from "@/lib/corporations/hostileTakeoverNotifications";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import type { ShareTradeParty } from "@/lib/db/types/shareTradeHistory";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { emitTx } from "@/lib/financialTxLog/emit";
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
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { sharesToAccept } = parsed.data;
    const db = await getDb();
    const forexEnabled = await isForexEnabled();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    if (!ObjectId.isValid(listingId) || !ObjectId.isValid(offerId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const [listing, offer] = await Promise.all([
      db.collection<ShareListing>("shareListings").findOne({ _id: new ObjectId(listingId) }),
      db.collection<ShareOffer>("shareOffers").findOne({ _id: new ObjectId(offerId) }),
    ]);

    if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    if (!listing.corporationId.equals(corporation._id)) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }
    if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 });
    if (listing.status !== "open")
      return NextResponse.json({ error: "Listing is not open" }, { status: 400 });
    if (offer.status !== "pending")
      return NextResponse.json({ error: "Offer is not pending" }, { status: 400 });
    if (!offer.listingId.equals(listing._id))
      return NextResponse.json({ error: "Offer does not belong to this listing" }, { status: 400 });
    // Turn-first expiry guard (matches the turn processor) with a Date fallback
    // for legacy listings — so a turn-expired listing can't accept offers during
    // a cron lag before the processor closes it.
    const listingExpired =
      typeof listing.expiresAtTurn === "number"
        ? (await getCurrentTurn(db)) >= listing.expiresAtTurn
        : new Date() >= listing.expiresAt;
    if (listingExpired) return NextResponse.json({ error: "Listing has expired" }, { status: 400 });

    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) return NextResponse.json({ error: "Character not found" }, { status: 404 });

    const tradeLock = await assertCeoTradeNotBlocked(db, corporation, character._id);
    if (tradeLock.blocked) {
      return NextResponse.json({ error: tradeLock.error }, { status: tradeLock.status });
    }

    if (listing.sellerCharacterId.toString() !== character._id.toString()) {
      return NextResponse.json({ error: "Only the seller can accept offers" }, { status: 403 });
    }

    const maxAcceptable = Math.min(offer.shares, listing.sharesRemaining);
    if (sharesToAccept > maxAcceptable) {
      return NextResponse.json(
        { error: `Cannot accept more than ${maxAcceptable.toLocaleString()} shares` },
        { status: 400 }
      );
    }

    const now = new Date();
    const currentTurn = await getCurrentTurn(db);
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
    const newListingRemaining = listing.sharesRemaining - sharesToAccept;
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
        return NextResponse.json(
          { error: "Exchange rate unavailable for seller" },
          { status: 503 }
        );
      }
      sellerFxRate = fxResult.rate;
    }

    const buyerCharForRefund =
      refund > 0 && !offer.buyerCorporationId
        ? await db
            .collection<Character>("characters")
            .findOne({ _id: offer.buyerCharacterId }, { projection: { countryId: 1, name: 1 } })
        : null;
    const buyerCurrency = buyerCharForRefund ? getHomeCurrency(buyerCharForRefund) : "USD";
    let buyerFxRate = 1.0;
    if (refund > 0 && !offer.buyerCorporationId && forexEnabled) {
      const fxResult = await loadCharacterFxRate(db, buyerCurrency);
      if (!fxResult.ok) {
        return NextResponse.json({ error: "Exchange rate unavailable for buyer" }, { status: 503 });
      }
      buyerFxRate = fxResult.rate;
    }

    const claimedOffer = await db.collection<ShareOffer>("shareOffers").findOneAndUpdate(
      {
        _id: offer._id,
        status: "pending",
      },
      { $set: { status: "accepted" } },
      { returnDocument: "before" }
    );

    if (!claimedOffer) {
      return NextResponse.json(
        { error: "Offer changed before this acceptance could be applied" },
        { status: 409 }
      );
    }

    // Atomic update: check sharesRemaining and update listing in one operation
    // This prevents race condition where two sellers accept offers simultaneously
    const listingUpdate = await db.collection<ShareListing>("shareListings").findOneAndUpdate(
      {
        _id: listing._id,
        sharesRemaining: { $gte: sharesToAccept },
        status: "open",
      },
      {
        $set: {
          sharesRemaining: newListingRemaining,
          ...(newListingRemaining === 0 ? { status: "filled" } : {}),
          updatedAt: now,
        },
      },
      { returnDocument: "after" }
    );

    if (!listingUpdate) {
      // Either listing was already updated by another request, or not enough shares remaining
      const freshListing = await db
        .collection<ShareListing>("shareListings")
        .findOne({ _id: listing._id });
      await db
        .collection<ShareOffer>("shareOffers")
        .updateOne({ _id: offer._id }, { $set: { status: "pending" } });
      if (!freshListing) {
        return NextResponse.json({ error: "Listing not found" }, { status: 404 });
      }
      if (freshListing.status !== "open") {
        return NextResponse.json({ error: "Listing is no longer open" }, { status: 400 });
      }
      return NextResponse.json(
        { error: "Not enough shares remaining (concurrent acceptance detected)" },
        { status: 400 }
      );
    }
    const rollback: Array<() => Promise<void>> = [];

    try {
      // Transfer shares to buyer (reserved shares already removed from seller when listing was created)
      if (offer.buyerCorporationId) {
        await creditSharesToCorp(
          db,
          listing.corporationId,
          offer.buyerCorporationId,
          sharesToAccept,
          offer.pricePerShare,
          { $set: { updatedAt: now } }
        );
        rollback.push(async () => {
          await debitSharesFromCorp(
            db,
            listing.corporationId,
            offer.buyerCorporationId!,
            sharesToAccept,
            {
              $set: { updatedAt: now },
            }
          );
        });
      } else {
        await creditShares(
          db,
          listing.corporationId,
          offer.buyerCharacterId,
          sharesToAccept,
          { $set: { updatedAt: now } },
          { pricePerShare: offer.pricePerShare }
        );
        rollback.push(async () => {
          await debitShares(db, listing.corporationId, offer.buyerCharacterId, sharesToAccept, {
            $set: { updatedAt: now },
          });
        });
      }

      // Pay seller proceeds
      if (listing.sellerCorporationId) {
        const sellerCorp = await db
          .collection<Corporation>("corporations")
          .findOne({ _id: listing.sellerCorporationId });
        const sellerFxRate = await getCorpFxRate(db, sellerCorp ?? {});
        const proceedsInSellerCapital = anchorToCorpLiquidCapital(
          proceeds,
          sellerCorp ?? {},
          sellerFxRate
        );
        const sellerCredit = await db
          .collection<Corporation>("corporations")
          .updateOne(
            { _id: listing.sellerCorporationId },
            { $inc: { liquidCapital: proceedsInSellerCapital }, $set: { updatedAt: now } }
          );
        if (sellerCredit.matchedCount === 0) {
          throw new Error("Seller corporation not found");
        }
        rollback.push(async () => {
          await db
            .collection<Corporation>("corporations")
            .updateOne(
              { _id: listing.sellerCorporationId! },
              { $inc: { liquidCapital: -proceedsInSellerCapital }, $set: { updatedAt: now } }
            );
        });
        await emitTx(db, {
          type: "stock_trade_sell",
          turn: currentTurn,
          createdAt: now,
          subjectType: "corporation",
          subjectId: listing.sellerCorporationId,
          subjectName: sellerCorp?.name ?? "Unknown corporation",
          amount: proceedsInSellerCapital,
          currencyCode: resolveCorpLiquidCurrencyCode(sellerCorp ?? {}) ?? "USD",
          counterpartyType: offer.buyerCorporationId ? "corporation" : "character",
          counterpartyId: offer.buyerCorporationId ?? offer.buyerCharacterId,
          counterpartyName: offer.buyerCorporationId ? "Buyer corporation" : "Buyer",
          meta: {
            listingId: listing._id.toString(),
            offerId: offer._id.toString(),
            corporationId: listing.corporationId.toString(),
            shares: sharesToAccept,
            pricePerShare: offer.pricePerShare,
          },
        });
      } else {
        const proceedsInSellerHome = proceeds * sellerFxRate;
        const sellerCredit = await db.collection<Character>("characters").updateOne(
          { _id: listing.sellerCharacterId },
          {
            $inc: buildPersonalBalanceInc(proceedsInSellerHome, sellerCurrency, forexEnabled),
            $set: { updatedAt: now },
          }
        );
        if (sellerCredit.matchedCount === 0) {
          throw new Error("Seller character not found");
        }
        rollback.push(async () => {
          await db.collection<Character>("characters").updateOne(
            { _id: listing.sellerCharacterId },
            {
              $inc: buildPersonalBalanceInc(-proceedsInSellerHome, sellerCurrency, forexEnabled),
              $set: { updatedAt: now },
            }
          );
        });
        await emitTx(db, {
          type: "stock_trade_sell",
          turn: currentTurn,
          createdAt: now,
          subjectType: "character",
          subjectId: listing.sellerCharacterId,
          subjectName: sellerChar?.name ?? character.name,
          amount: proceedsInSellerHome,
          currencyCode: sellerCurrency,
          counterpartyType: offer.buyerCorporationId ? "corporation" : "character",
          counterpartyId: offer.buyerCorporationId ?? offer.buyerCharacterId,
          counterpartyName: offer.buyerCorporationId ? "Buyer corporation" : "Buyer",
          meta: {
            listingId: listing._id.toString(),
            offerId: offer._id.toString(),
            corporationId: listing.corporationId.toString(),
            shares: sharesToAccept,
            pricePerShare: offer.pricePerShare,
          },
        });
      }

      // Refund unaccepted portion of offer escrow
      if (refund > 0) {
        if (offer.buyerCorporationId) {
          const buyerCorp = await db
            .collection<Corporation>("corporations")
            .findOne({ _id: offer.buyerCorporationId });
          const buyerFxRate = await getCorpFxRate(db, buyerCorp ?? {});
          const refundInBuyerCapital = anchorToCorpLiquidCapital(
            refund,
            buyerCorp ?? {},
            buyerFxRate
          );
          const buyerRefund = await db
            .collection<Corporation>("corporations")
            .updateOne(
              { _id: offer.buyerCorporationId },
              { $inc: { liquidCapital: refundInBuyerCapital }, $set: { updatedAt: now } }
            );
          if (buyerRefund.matchedCount === 0) {
            throw new Error("Buyer corporation not found");
          }
          rollback.push(async () => {
            await db
              .collection<Corporation>("corporations")
              .updateOne(
                { _id: offer.buyerCorporationId! },
                { $inc: { liquidCapital: -refundInBuyerCapital }, $set: { updatedAt: now } }
              );
          });
          await emitTx(db, {
            type: "share_listing_refund",
            turn: currentTurn,
            createdAt: now,
            subjectType: "corporation",
            subjectId: offer.buyerCorporationId,
            subjectName: buyerCorp?.name ?? "Unknown corporation",
            amount: refundInBuyerCapital,
            currencyCode: resolveCorpLiquidCurrencyCode(buyerCorp ?? {}) ?? "USD",
            counterpartyType: "system",
            counterpartyName: "Private listing escrow",
            meta: {
              listingId: listing._id.toString(),
              offerId: offer._id.toString(),
              corporationId: listing.corporationId.toString(),
              sharesRefunded: offer.shares - sharesToAccept,
              pricePerShare: offer.pricePerShare,
            },
          });
        } else {
          const refundInBuyerHome = refund * buyerFxRate;
          const buyerRefund = await db.collection<Character>("characters").updateOne(
            { _id: offer.buyerCharacterId },
            {
              $inc: buildPersonalBalanceInc(refundInBuyerHome, buyerCurrency, forexEnabled),
              $set: { updatedAt: now },
            }
          );
          if (buyerRefund.matchedCount === 0) {
            throw new Error("Buyer character not found");
          }
          rollback.push(async () => {
            await db.collection<Character>("characters").updateOne(
              { _id: offer.buyerCharacterId },
              {
                $inc: buildPersonalBalanceInc(-refundInBuyerHome, buyerCurrency, forexEnabled),
                $set: { updatedAt: now },
              }
            );
          });
          await emitTx(db, {
            type: "share_listing_refund",
            turn: currentTurn,
            createdAt: now,
            subjectType: "character",
            subjectId: offer.buyerCharacterId,
            subjectName: buyerCharForRefund?.name ?? "Unknown character",
            amount: refundInBuyerHome,
            currencyCode: buyerCurrency,
            counterpartyType: "system",
            counterpartyName: "Private listing escrow",
            meta: {
              listingId: listing._id.toString(),
              offerId: offer._id.toString(),
              corporationId: listing.corporationId.toString(),
              sharesRefunded: offer.shares - sharesToAccept,
              pricePerShare: offer.pricePerShare,
            },
          });
        }
      }
    } catch (err) {
      for (const undo of rollback.reverse()) {
        await undo();
      }
      await Promise.all([
        db.collection<ShareListing>("shareListings").updateOne(
          { _id: listing._id },
          {
            $set: {
              sharesRemaining: listing.sharesRemaining,
              status: listing.status,
              updatedAt: new Date(),
            },
          }
        ),
        db
          .collection<ShareOffer>("shareOffers")
          .updateOne({ _id: offer._id }, { $set: { status: "pending" } }),
      ]);
      throw err;
    }

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

    void (async () => {
      // Resolve party names for the history row. Listing seller is always a
      // character or corp (per sellerCorporationId/sellerCharacterId schema),
      // buyer may be either too.
      let historyFrom: ShareTradeParty;
      if (listing.sellerCorporationId) {
        const sellerCorp = await db
          .collection<Corporation>("corporations")
          .findOne({ _id: listing.sellerCorporationId }, { projection: { name: 1 } });
        historyFrom = {
          corporationId: listing.sellerCorporationId,
          name: sellerCorp?.name ?? "Unknown corporation",
        };
      } else {
        const sellerCharDoc = await db
          .collection<Character>("characters")
          .findOne({ _id: listing.sellerCharacterId }, { projection: { name: 1 } });
        historyFrom = {
          characterId: listing.sellerCharacterId,
          name: sellerCharDoc?.name ?? "Unknown character",
        };
      }
      let historyTo: ShareTradeParty;
      if (offer.buyerCorporationId) {
        const buyerCorpDoc = await db
          .collection<Corporation>("corporations")
          .findOne({ _id: offer.buyerCorporationId }, { projection: { name: 1 } });
        historyTo = {
          corporationId: offer.buyerCorporationId,
          name: buyerCorpDoc?.name ?? "Unknown corporation",
        };
      } else {
        const buyerCharDoc = await db
          .collection<Character>("characters")
          .findOne({ _id: offer.buyerCharacterId }, { projection: { name: 1 } });
        historyTo = {
          characterId: offer.buyerCharacterId,
          name: buyerCharDoc?.name ?? "Unknown character",
        };
      }
      // offer.pricePerShare is stored in the listing corp's liquidCurrencyCode
      // (Option B). Convert to ₳ for the audit row — `proceeds` above is already
      // the ₳-anchored total, so per-share ₳ = proceeds / sharesToAccept.
      void recordShareTrade(db, {
        corporationId: listing.corporationId,
        kind: "listing_fill",
        turn: currentTurn,
        shares: sharesToAccept,
        pricePerShareAnchor: proceeds / sharesToAccept,
        from: historyFrom,
        to: historyTo,
        corpCurrencyCode: listingCorp?.liquidCurrencyCode,
      });
    })().catch(() => undefined);

    void notifyHostileTakeoverThresholdIfEligible(db, listing.corporationId);

    return NextResponse.json({
      success: true,
      sharesTransferred: sharesToAccept,
      proceeds,
      refundedToOffer: refund,
      listingSharesRemaining: newListingRemaining,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
