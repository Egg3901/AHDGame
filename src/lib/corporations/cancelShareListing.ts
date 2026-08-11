import { ObjectId, type Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { Character, Corporation, ShareListing, ShareOffer } from "@/lib/db/types";
import {
  creditShares,
  creditSharesToCorp,
  debitShares,
  debitSharesFromCorp,
} from "@/lib/corporations/shareholderOps";
import { buildPersonalBalanceInc, getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { emitTx } from "@/lib/financialTxLog/emit";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

export interface CancelListingResult {
  ok: true;
  refundedOffers: number;
  sharesReturned: number;
}

export interface CancelListingError {
  ok: false;
  /** Set when forex is enabled but a needed buyer-home-currency rate is missing. */
  rateUnavailable?: boolean;
  error: string;
}

type PreparedRefund = {
  offer: ShareOffer;
  subjectType: "character" | "corporation";
  subjectId: ShareOffer["buyerCharacterId"] | NonNullable<ShareOffer["buyerCorporationId"]>;
  subjectName: string;
  currencyCode: CurrencyCode;
  refundAmount: number;
};

async function restoreListingOpen(db: Db, listingId: ShareListing["_id"], now: Date) {
  await db
    .collection<ShareListing>("shareListings")
    .updateOne(
      { _id: listingId, status: "cancelled" },
      { $set: { status: "open", updatedAt: now } }
    );
}

async function restoreOfferPending(db: Db, offerId: ShareOffer["_id"], now: Date) {
  await db
    .collection<ShareOffer>("shareOffers")
    .updateOne(
      { _id: offerId, status: "cancelled" },
      { $set: { status: "pending", updatedAt: now } }
    );
}

/**
 * Cancel an open share listing: mark it cancelled, refund all pending offer
 * escrows to buyers, and return reserved shares to the seller.
 *
 * Escrows on each offer are denominated in the listing corporation's
 * `liquidCurrencyCode`. We claim the listing before preparing refunds so no
 * new offers can land mid-cancel, but we validate every FX prerequisite before
 * any offer status flips so a temporary rate outage never strands escrow.
 */
export async function cancelShareListingAndRefund(
  db: Db,
  listing: ShareListing,
  now: Date,
  forexEnabled: boolean,
  /** Pre-fetched listing corp doc. Omit to have the helper fetch its own copy. */
  listingCorpDocOverride?: Corporation | null
): Promise<CancelListingResult | CancelListingError> {
  if (listing.status !== "open") return { ok: false, error: "Listing is not open" };

  const listingClaim = await db
    .collection<ShareListing>("shareListings")
    .updateOne(
      { _id: listing._id, status: "open" },
      { $set: { status: "cancelled", updatedAt: now } }
    );
  if (listingClaim.matchedCount === 0) {
    return { ok: false, error: "Listing is not open" };
  }

  const pendingOffers = await db
    .collection<ShareOffer>("shareOffers")
    .find({ listingId: listing._id, status: "pending" })
    .toArray();

  const listingCorpDoc =
    listingCorpDocOverride ??
    (await db.collection<Corporation>("corporations").findOne({ _id: listing.corporationId }));
  const listingCorpFxRate = await getCorpFxRate(db, listingCorpDoc ?? {});

  const buyerCorpIds = [
    ...new Set(
      pendingOffers.flatMap((offer) =>
        offer.buyerCorporationId ? [offer.buyerCorporationId.toString()] : []
      )
    ),
  ];
  const buyerCharIds = [
    ...new Set(
      pendingOffers
        .filter((offer) => !offer.buyerCorporationId)
        .map((offer) => offer.buyerCharacterId.toString())
    ),
  ];

  const [buyerCorpDocs, buyerCharDocs, fxByCurrency] = await Promise.all([
    buyerCorpIds.length > 0
      ? db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: buyerCorpIds.map((id) => new ObjectId(id)) } })
          .toArray()
      : Promise.resolve([] as Corporation[]),
    buyerCharIds.length > 0
      ? db
          .collection<Character>("characters")
          .find(
            { _id: { $in: buyerCharIds.map((id) => new ObjectId(id)) } },
            { projection: { _id: 1, countryId: 1, name: 1 } }
          )
          .toArray()
      : Promise.resolve([] as Pick<Character, "_id" | "countryId" | "name">[]),
    forexEnabled ? loadFxRatesByCurrency(db) : Promise.resolve(null),
  ]);

  const buyerCorpById = new Map(buyerCorpDocs.map((corp) => [corp._id.toString(), corp]));
  const buyerCharById = new Map(buyerCharDocs.map((char) => [char._id.toString(), char]));
  const preparedRefunds: PreparedRefund[] = [];

  for (const offer of pendingOffers) {
    const refundAnchor = corpLiquidCapitalToAnchor(
      offer.escrowAmount,
      listingCorpDoc ?? {},
      listingCorpFxRate
    );

    if (offer.buyerCorporationId) {
      const buyerCorp = buyerCorpById.get(offer.buyerCorporationId.toString());
      if (!buyerCorp) {
        await restoreListingOpen(db, listing._id, now);
        return { ok: false, error: "Buyer corporation not found" };
      }
      const buyerFxRate = await getCorpFxRate(db, buyerCorp);
      preparedRefunds.push({
        offer,
        subjectType: "corporation",
        subjectId: offer.buyerCorporationId,
        subjectName: buyerCorp.name,
        currencyCode: resolveCorpLiquidCurrencyCode(buyerCorp) ?? "USD",
        refundAmount: anchorToCorpLiquidCapital(refundAnchor, buyerCorp, buyerFxRate),
      });
      continue;
    }

    const buyerChar = buyerCharById.get(offer.buyerCharacterId.toString());
    if (!buyerChar) {
      await restoreListingOpen(db, listing._id, now);
      return { ok: false, error: "Buyer character not found" };
    }
    const homeCurrency = getHomeCurrency(buyerChar);
    if (forexEnabled && fxByCurrency && homeCurrency !== "USD" && !fxByCurrency.has(homeCurrency)) {
      await restoreListingOpen(db, listing._id, now);
      return {
        ok: false,
        rateUnavailable: true,
        error: "Exchange rate unavailable, try again shortly",
      };
    }
    preparedRefunds.push({
      offer,
      subjectType: "character",
      subjectId: offer.buyerCharacterId,
      subjectName: buyerChar.name,
      currencyCode: homeCurrency,
      refundAmount: refundAnchor * (fxByCurrency?.get(homeCurrency) ?? 1),
    });
  }

  const currentTurn = await getCurrentTurn(db);
  let refundedOffers = 0;
  const refundRollbacks: Array<() => Promise<void>> = [];

  let sharesReturned = 0;
  try {
    for (const refund of preparedRefunds) {
      const offerClaim = await db
        .collection<ShareOffer>("shareOffers")
        .updateOne(
          { _id: refund.offer._id, status: "pending" },
          { $set: { status: "cancelled", updatedAt: now } }
        );
      if (offerClaim.matchedCount === 0) {
        continue;
      }

      if (refund.subjectType === "corporation") {
        const refundResult = await db.collection<Corporation>("corporations").updateOne(
          { _id: refund.subjectId },
          {
            $inc: { liquidCapital: refund.refundAmount },
            $set: { updatedAt: now },
          }
        );
        if (refundResult.matchedCount === 0) {
          throw new Error("Buyer corporation not found");
        }
      } else {
        const refundResult = await db.collection<Character>("characters").updateOne(
          { _id: refund.subjectId },
          {
            $inc: buildPersonalBalanceInc(refund.refundAmount, refund.currencyCode, forexEnabled),
            $set: { updatedAt: now },
          }
        );
        if (refundResult.matchedCount === 0) {
          throw new Error("Buyer character not found");
        }
      }

      refundedOffers++;
      refundRollbacks.push(async () => {
        if (refund.subjectType === "corporation") {
          await db.collection<Corporation>("corporations").updateOne(
            { _id: refund.subjectId },
            {
              $inc: { liquidCapital: -refund.refundAmount },
              $set: { updatedAt: new Date() },
            }
          );
        } else {
          await db.collection<Character>("characters").updateOne(
            { _id: refund.subjectId },
            {
              $inc: buildPersonalBalanceInc(
                -refund.refundAmount,
                refund.currencyCode,
                forexEnabled
              ),
              $set: { updatedAt: new Date() },
            }
          );
        }
        await restoreOfferPending(db, refund.offer._id, new Date());
      });
      await emitTx(db, {
        type: "share_listing_refund",
        turn: currentTurn,
        createdAt: now,
        subjectType: refund.subjectType,
        subjectId: refund.subjectId,
        subjectName: refund.subjectName,
        amount: Math.round(refund.refundAmount * 100) / 100,
        currencyCode: refund.currencyCode,
        counterpartyType: "system",
        counterpartyName: "Private listing escrow",
        meta: {
          listingId: listing._id.toString(),
          offerId: refund.offer._id.toString(),
          corporationId: listing.corporationId.toString(),
          shares: refund.offer.shares,
          pricePerShare: refund.offer.pricePerShare,
          reason: "listing_cancelled",
        },
      });
    }

    if (listing.sharesRemaining > 0) {
      sharesReturned = listing.sharesRemaining;
      if (listing.sellerCorporationId) {
        const targetCorp = await db.collection<Corporation>("corporations").findOne(
          {
            _id: listing.corporationId,
            "shareholders.corporationId": listing.sellerCorporationId,
          },
          { projection: { "shareholders.$": 1 } }
        );
        const existingAvg =
          targetCorp?.shareholders?.[0]?.avgCostPerShare ?? listing.marketPriceAtCreation;
        const restored = await creditSharesToCorp(
          db,
          listing.corporationId,
          listing.sellerCorporationId,
          listing.sharesRemaining,
          existingAvg,
          { $set: { updatedAt: now } }
        );
        if (!restored) {
          throw new Error("Failed to restore seller corporation shares");
        }
      } else {
        const targetCorp = await db
          .collection<Corporation>("corporations")
          .findOne(
            { _id: listing.corporationId, "shareholders.characterId": listing.sellerCharacterId },
            { projection: { "shareholders.$": 1 } }
          );
        const returnPrice =
          targetCorp?.shareholders?.[0]?.avgCostPerShare ?? listing.marketPriceAtCreation;
        const restored = await creditShares(
          db,
          listing.corporationId,
          listing.sellerCharacterId,
          listing.sharesRemaining,
          { $set: { updatedAt: now } },
          { pricePerShare: returnPrice }
        );
        if (!restored) {
          throw new Error("Failed to restore seller shares");
        }
      }
    }
  } catch (error) {
    if (sharesReturned > 0) {
      if (listing.sellerCorporationId) {
        await debitSharesFromCorp(
          db,
          listing.corporationId,
          listing.sellerCorporationId,
          listing.sharesRemaining,
          { $set: { updatedAt: new Date() } },
          { requireSufficient: true }
        );
      } else {
        await debitShares(
          db,
          listing.corporationId,
          listing.sellerCharacterId,
          listing.sharesRemaining,
          { $set: { updatedAt: new Date() } },
          { requireSufficient: true }
        );
      }
    }

    for (const undo of refundRollbacks.reverse()) {
      await undo();
    }
    await restoreListingOpen(db, listing._id, new Date());

    const message = error instanceof Error ? error.message : "Failed to cancel listing";
    if (message === "Buyer corporation not found" || message === "Buyer character not found") {
      return { ok: false, error: message };
    }
    throw error;
  }

  return { ok: true, refundedOffers, sharesReturned };
}
