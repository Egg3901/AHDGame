import { ObjectId, type Db } from "mongodb";
import type { Character, Corporation, ShareListing, ShareOffer, ShareOrder } from "@/lib/db/types";
import { cancelShareListingAndRefund } from "@/lib/corporations/cancelShareListing";
import { cancelShareOrderAndRefund } from "@/lib/corporations/cancelShareOrder";
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

export interface ShareMarketCleanupResult {
  ordersCancelled: number;
  listingsCancelled: number;
  offersCancelled: number;
}

export async function cancelPendingShareOfferAndRefund(
  db: Db,
  offer: ShareOffer,
  now: Date,
  forexEnabled: boolean
): Promise<boolean> {
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
    if (!buyerCorp) {
      const cancelRes = await db
        .collection<ShareOffer>("shareOffers")
        .updateOne(
          { _id: offer._id, status: "pending" },
          { $set: { status: "cancelled", updatedAt: now } }
        );
      return cancelRes.modifiedCount === 1;
    }

    const buyerFxRate = await getCorpFxRate(db, buyerCorp);
    const refundInBuyerCapital = anchorToCorpLiquidCapital(refundAnchor, buyerCorp, buyerFxRate);
    const cancelRes = await db
      .collection<ShareOffer>("shareOffers")
      .updateOne(
        { _id: offer._id, status: "pending" },
        { $set: { status: "cancelled", updatedAt: now } }
      );
    if (cancelRes.modifiedCount !== 1) return false;
    await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: offer.buyerCorporationId },
        { $inc: { liquidCapital: refundInBuyerCapital }, $set: { updatedAt: now } }
      );
    await emitTx(db, {
      type: "share_listing_refund",
      turn: currentTurn,
      createdAt: now,
      subjectType: "corporation",
      subjectId: offer.buyerCorporationId,
      subjectName: buyerCorp.name,
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
        reason: "market_cleanup",
      },
    });
    return true;
  }

  const buyerChar = await db
    .collection<Character>("characters")
    .findOne({ _id: offer.buyerCharacterId }, { projection: { countryId: 1, name: 1 } });
  if (!buyerChar) {
    const cancelRes = await db
      .collection<ShareOffer>("shareOffers")
      .updateOne(
        { _id: offer._id, status: "pending" },
        { $set: { status: "cancelled", updatedAt: now } }
      );
    return cancelRes.modifiedCount === 1;
  }

  const buyerCurrency = getHomeCurrency(buyerChar);
  let buyerFxRate = 1.0;
  if (forexEnabled) {
    const fxResult = await loadCharacterFxRate(db, buyerCurrency);
    if (!fxResult.ok) {
      throw new Error("Exchange rate unavailable, try again shortly");
    }
    buyerFxRate = fxResult.rate;
  }
  const refundInBuyerHome = refundAnchor * buyerFxRate;
  const cancelRes = await db
    .collection<ShareOffer>("shareOffers")
    .updateOne(
      { _id: offer._id, status: "pending" },
      { $set: { status: "cancelled", updatedAt: now } }
    );
  if (cancelRes.modifiedCount !== 1) return false;
  await db.collection<Character>("characters").updateOne(
    { _id: offer.buyerCharacterId },
    {
      $inc: buildPersonalBalanceInc(refundInBuyerHome, buyerCurrency, forexEnabled),
      $set: { updatedAt: now },
    }
  );
  await emitTx(db, {
    type: "share_listing_refund",
    turn: currentTurn,
    createdAt: now,
    subjectType: "character",
    subjectId: offer.buyerCharacterId,
    subjectName: buyerChar.name ?? "(unknown)",
    amount: Math.round(refundInBuyerHome * 100) / 100,
    currencyCode: buyerCurrency,
    counterpartyType: "system",
    counterpartyName: "Private listing escrow",
    meta: {
      listingId: offer.listingId.toString(),
      offerId: offer._id.toString(),
      corporationId: offer.corporationId.toString(),
      shares: offer.shares,
      pricePerShare: offer.pricePerShare,
      reason: "market_cleanup",
    },
  });
  return true;
}

async function cancelOpenOrders(db: Db, filter: Record<string, unknown>): Promise<number> {
  const openOrders = await db
    .collection<ShareOrder>("shareOrders")
    .find({ status: "open", ...filter })
    .toArray();

  let ordersCancelled = 0;
  const seenOrders = new Set<string>();
  for (const order of openOrders) {
    const orderId = order._id.toString();
    if (seenOrders.has(orderId)) continue;
    seenOrders.add(orderId);
    const result = await cancelShareOrderAndRefund(db, order);
    if (!result.ok) throw new Error(result.error);
    ordersCancelled += 1;
  }
  return ordersCancelled;
}

async function cancelOpenListings(
  db: Db,
  filter: Record<string, unknown>,
  now: Date,
  forexEnabled: boolean
): Promise<number> {
  const openListings = await db
    .collection<ShareListing>("shareListings")
    .find({ status: "open", ...filter })
    .toArray();

  let listingsCancelled = 0;
  const seenListings = new Set<string>();
  for (const listing of openListings) {
    const listingId = listing._id.toString();
    if (seenListings.has(listingId)) continue;
    seenListings.add(listingId);
    const result = await cancelShareListingAndRefund(db, listing, now, forexEnabled);
    if (!result.ok) throw new Error(result.error);
    listingsCancelled += 1;
  }
  return listingsCancelled;
}

async function cancelPendingOffers(
  db: Db,
  filter: Record<string, unknown>,
  now: Date,
  forexEnabled: boolean
): Promise<number> {
  const pendingOffers = await db
    .collection<ShareOffer>("shareOffers")
    .find({ status: "pending", ...filter })
    .toArray();

  let offersCancelled = 0;
  const seenOffers = new Set<string>();
  for (const offer of pendingOffers) {
    const offerId = offer._id.toString();
    if (seenOffers.has(offerId)) continue;
    seenOffers.add(offerId);
    const cancelled = await cancelPendingShareOfferAndRefund(db, offer, now, forexEnabled);
    if (cancelled) offersCancelled += 1;
  }
  return offersCancelled;
}

export async function cleanupShareMarketActivityForCharacters(
  db: Db,
  characterIds: ObjectId[],
  now: Date,
  forexEnabled: boolean,
  opts?: { excludeCorporationIds?: ObjectId[] }
): Promise<ShareMarketCleanupResult> {
  if (characterIds.length === 0) {
    return { ordersCancelled: 0, listingsCancelled: 0, offersCancelled: 0 };
  }

  // When the caller spares certain issuers (e.g. corps an inactive holder owns /
  // is CEO of), their orders/listings/offers must be left intact.
  const exclude = opts?.excludeCorporationIds ?? [];
  const corpFilter: Record<string, unknown> =
    exclude.length > 0 ? { corporationId: { $nin: exclude } } : {};

  const [ordersCancelled, listingsCancelled, offersCancelled] = await Promise.all([
    cancelOpenOrders(db, { characterId: { $in: characterIds }, ...corpFilter }),
    cancelOpenListings(
      db,
      { sellerCharacterId: { $in: characterIds }, ...corpFilter },
      now,
      forexEnabled
    ),
    cancelPendingOffers(
      db,
      { buyerCharacterId: { $in: characterIds }, ...corpFilter },
      now,
      forexEnabled
    ),
  ]);

  return { ordersCancelled, listingsCancelled, offersCancelled };
}

export async function cleanupShareMarketActivityForCorporations(
  db: Db,
  corporationIds: ObjectId[],
  now: Date,
  forexEnabled: boolean
): Promise<ShareMarketCleanupResult> {
  if (corporationIds.length === 0) {
    return { ordersCancelled: 0, listingsCancelled: 0, offersCancelled: 0 };
  }

  const [ordersCancelled, listingsCancelled, offersCancelled] = await Promise.all([
    cancelOpenOrders(db, { placerCorporationId: { $in: corporationIds } }),
    cancelOpenListings(db, { sellerCorporationId: { $in: corporationIds } }, now, forexEnabled),
    cancelPendingOffers(db, { buyerCorporationId: { $in: corporationIds } }, now, forexEnabled),
  ]);

  return { ordersCancelled, listingsCancelled, offersCancelled };
}

export async function cleanupShareMarketActivityForCorporationTargets(
  db: Db,
  corporationIds: ObjectId[],
  now: Date,
  forexEnabled: boolean
): Promise<ShareMarketCleanupResult> {
  if (corporationIds.length === 0) {
    return { ordersCancelled: 0, listingsCancelled: 0, offersCancelled: 0 };
  }

  const ordersCancelled = await cancelOpenOrders(db, { corporationId: { $in: corporationIds } });
  const listingsCancelled = await cancelOpenListings(
    db,
    { corporationId: { $in: corporationIds } },
    now,
    forexEnabled
  );
  const offersCancelled = await cancelPendingOffers(
    db,
    { corporationId: { $in: corporationIds } },
    now,
    forexEnabled
  );

  return { ordersCancelled, listingsCancelled, offersCancelled };
}
