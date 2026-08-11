import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type {
  Character,
  Corporation,
  Notification,
  ShareListing,
  ShareOffer,
} from "@/lib/db/types";
import { creditShares, creditSharesToCorp } from "@/lib/corporations/shareholderOps";
import { buildPersonalBalanceBulkOp } from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  anchorToCorpCapital,
  corpLiquidCapitalToAnchor,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP, INITIAL_RATES, type CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";

/**
 * Expire share listings whose expiresAt has passed:
 * 1. Return reserved shares to sellers.
 * 2. Refund all pending offer escrows to buyers.
 * 3. Send notifications to buyers with pending offers.
 */
export async function expireShareListings(db: Db, now: Date, currentTurn: number): Promise<void> {
  // Turn-first expiry (freezes on pause) with a wall-clock fallback for legacy
  // listings created before `expiresAtTurn` existed.
  const expiredListings = await db
    .collection<ShareListing>("shareListings")
    .find({
      status: "open",
      $or: [
        { expiresAtTurn: { $lte: currentTurn } },
        { expiresAtTurn: { $exists: false }, expiresAt: { $lte: now } },
      ],
    })
    .toArray();

  if (expiredListings.length === 0) return;

  const listingIds = expiredListings.map((l) => l._id);

  // Fetch all pending offers for expired listings
  const pendingOffers = await db
    .collection<ShareOffer>("shareOffers")
    .find({ listingId: { $in: listingIds }, status: "pending" })
    .toArray();

  // Mark all expired listings cancelled
  await db
    .collection<ShareListing>("shareListings")
    .updateMany({ _id: { $in: listingIds } }, { $set: { status: "cancelled" } });

  // Mark all pending offers expired
  if (pendingOffers.length > 0) {
    const offerIds = pendingOffers.map((o) => o._id);
    await db
      .collection<ShareOffer>("shareOffers")
      .updateMany({ _id: { $in: offerIds } }, { $set: { status: "expired" } });
  }

  // Build escrow refund maps — each offer.escrowAmount is in its LISTING
  // corp's liquidCurrencyCode (Option B). Different listings on this expiry
  // batch may target different corps in different currencies, so we normalize
  // each offer to ₳ before aggregating per buyer.
  const charCashRefunds = new Map<string, number>();
  const corpLiquidRefunds = new Map<string, number>();
  // One notification per unique buyer+listing combination
  const notifyKeys = new Map<string, { charId: ObjectId; listingId: string }>();

  // Load every listing corp's FX info up front (plus the global rate map).
  const listingCorpIds = [...new Set(pendingOffers.map((o) => o.corporationId.toString()))].map(
    (id) => new ObjectId(id)
  );
  const listingCorps =
    listingCorpIds.length > 0
      ? await db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: listingCorpIds } })
          .project<Pick<Corporation, "_id" | "liquidCurrencyCode" | "countryId">>({
            _id: 1,
            liquidCurrencyCode: 1,
            countryId: 1,
          })
          .toArray()
      : [];
  const listingCorpMap = new Map(listingCorps.map((c) => [c._id.toString(), c]));
  const expiryFxByCurrency = await loadFxRatesByCurrency(db);

  for (const offer of pendingOffers) {
    const listingCorp = listingCorpMap.get(offer.corporationId.toString());
    const listingCurrency = resolveCorpLiquidCurrencyCode(listingCorp ?? {});
    const listingRate = listingCurrency ? (expiryFxByCurrency.get(listingCurrency) ?? 1.0) : 1.0;
    const escrowAnchor = corpLiquidCapitalToAnchor(
      offer.escrowAmount,
      listingCorp ?? {},
      listingRate
    );

    if (offer.buyerCorporationId) {
      const key = offer.buyerCorporationId.toString();
      corpLiquidRefunds.set(key, (corpLiquidRefunds.get(key) ?? 0) + escrowAnchor);
    } else {
      const key = offer.buyerCharacterId.toString();
      charCashRefunds.set(key, (charCashRefunds.get(key) ?? 0) + escrowAnchor);
    }
    const notifyKey = `${offer.buyerCharacterId.toString()}:${offer.listingId.toString()}`;
    if (!notifyKeys.has(notifyKey)) {
      notifyKeys.set(notifyKey, {
        charId: offer.buyerCharacterId,
        listingId: offer.listingId.toString(),
      });
    }
  }

  // Collect refund tx entries to emit at the end of this function (batched).
  const refundTxEntries: Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">[] = [];

  // Refund character cash — need character countries for currency-aware refunds
  if (charCashRefunds.size > 0) {
    const forexEnabled = await isForexEnabled();
    const refundCharIds = [...charCashRefunds.keys()].map((id) => new ObjectId(id));
    const refundChars = await db
      .collection<Character>("characters")
      .find({ _id: { $in: refundCharIds } })
      .project<{ _id: ObjectId; countryId: string; name: string }>({
        _id: 1,
        countryId: 1,
        name: 1,
      })
      .toArray();
    const charCountryMap = new Map(refundChars.map((c) => [c._id.toString(), c.countryId]));
    const charNameMap = new Map(refundChars.map((c) => [c._id.toString(), c.name]));

    // Load live FX rates for home-currency conversion; fall back to INITIAL_RATES when DB
    // row is missing (turn processing must not halt on a missing rate).
    const fxByCurrency = forexEnabled ? await loadFxRatesByCurrency(db) : null;

    const ops = [...charCashRefunds.entries()].map(([charIdStr, amount]) => {
      const countryId = charCountryMap.get(charIdStr) ?? "US";
      const currency: CurrencyCode =
        COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP] ?? "USD";
      // Convert ₳ escrow amount to home currency; use INITIAL_RATES as fallback when live rate
      // is unavailable so characters always receive the correct denomination. USD floats
      // against ₳ like every other forex-active currency — must use the live rate, not 1.0.
      const rate =
        forexEnabled && fxByCurrency
          ? (fxByCurrency.get(currency) ?? INITIAL_RATES[countryId as CountryId] ?? 1.0)
          : 1.0;
      const amountInCurrency = forexEnabled ? amount * rate : amount;

      // share_listing_refund: pre-Phase-3 the buyer's cash silently came back
      // when a listing expired. Phase 3 emits one row per refunded character
      // so admin queries can see returned escrow alongside the original
      // outflow on the offer-creation path.
      refundTxEntries.push({
        type: "share_listing_refund",
        turn: 0,
        createdAt: now,
        subjectType: "character",
        subjectId: new ObjectId(charIdStr),
        subjectName: charNameMap.get(charIdStr) ?? "(unknown)",
        amount: Math.round(amountInCurrency * 100) / 100,
        currencyCode: currency,
        counterpartyType: "system",
        counterpartyName: "Listing escrow",
        meta: { escrowAnchor: Math.round(amount * 100) / 100 },
      });

      return buildPersonalBalanceBulkOp(
        new ObjectId(charIdStr),
        amountInCurrency,
        currency,
        forexEnabled
      );
    });
    // bulkWrite op array type doesn't satisfy AnyBulkWriteOperation narrowing — runtime shape is valid
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.collection<Character>("characters").bulkWrite(ops as any);
  }

  // Refund corporation liquid capital. Escrow amounts are stored in ₳; each
  // corp's liquidCapital is in its home currency, so convert on refund.
  if (corpLiquidRefunds.size > 0) {
    const refundCorpIds = [...corpLiquidRefunds.keys()].map((id) => new ObjectId(id));
    const refundCorps = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: refundCorpIds } })
      .project<{
        _id: ObjectId;
        name: string;
        liquidCurrencyCode?: CurrencyCode;
        countryId?: string;
      }>({
        _id: 1,
        name: 1,
        liquidCurrencyCode: 1,
        countryId: 1,
      })
      .toArray();
    // Resolve via the helper so corps with `countryId` but no `liquidCurrencyCode`
    // stamped yet fall back to COUNTRY_CURRENCY_MAP — otherwise the refund lands
    // as raw ₳ in a local-denominated liquidCapital field.
    const corpCurrencyMap = new Map(
      refundCorps.map((c) => [c._id.toString(), resolveCorpLiquidCurrencyCode(c)])
    );
    const corpNameMap = new Map(refundCorps.map((c) => [c._id.toString(), c.name]));
    const fxByCurrency = await loadFxRatesByCurrency(db);
    const ops = [...corpLiquidRefunds.entries()].map(([corpIdStr, amount]) => {
      const code = corpCurrencyMap.get(corpIdStr);
      // USD floats against ₳ like every other forex-active currency — must use
      // the live rate, not 1.0. See invariant in corporationCapital.ts:13-17.
      const rate = code ? (fxByCurrency.get(code) ?? 1.0) : 1.0;
      const refund = anchorToCorpCapital(amount, code, rate);

      refundTxEntries.push({
        type: "share_listing_refund",
        turn: 0,
        createdAt: now,
        subjectType: "corporation",
        subjectId: new ObjectId(corpIdStr),
        subjectName: corpNameMap.get(corpIdStr) ?? "(unknown)",
        amount: Math.round(refund * 100) / 100,
        currencyCode: (code ?? "USD") as CurrencyCode,
        counterpartyType: "system",
        counterpartyName: "Listing escrow",
        meta: { escrowAnchor: Math.round(amount * 100) / 100 },
      });

      return {
        updateOne: {
          filter: { _id: new ObjectId(corpIdStr) },
          update: { $inc: { liquidCapital: refund }, $set: { updatedAt: now } },
        },
      };
    });
    // bulkWrite op array type doesn't satisfy AnyBulkWriteOperation narrowing — runtime shape is valid
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.collection<Corporation>("corporations").bulkWrite(ops as any);
  }

  // Emit batched refund tx entries.
  if (refundTxEntries.length > 0) {
    const thresholds = await loadTxThresholds(db);
    void emitTxBulk(db, refundTxEntries, thresholds);
  }

  // Return reserved shares to sellers
  for (const listing of expiredListings) {
    if (listing.sharesRemaining <= 0) continue;
    if (listing.sellerCorporationId) {
      const targetCorp = await db
        .collection<Corporation>("corporations")
        .findOne(
          { _id: listing.corporationId, "shareholders.corporationId": listing.sellerCorporationId },
          { projection: { "shareholders.$": 1 } }
        );
      const existingAvg =
        targetCorp?.shareholders?.[0]?.avgCostPerShare ?? listing.marketPriceAtCreation;
      await creditSharesToCorp(
        db,
        listing.corporationId,
        listing.sellerCorporationId,
        listing.sharesRemaining,
        existingAvg,
        { $set: { updatedAt: now } }
      );
    } else {
      const targetCorp = await db
        .collection<Corporation>("corporations")
        .findOne(
          { _id: listing.corporationId, "shareholders.characterId": listing.sellerCharacterId },
          { projection: { "shareholders.$": 1 } }
        );
      const returnPrice =
        targetCorp?.shareholders?.[0]?.avgCostPerShare ?? listing.marketPriceAtCreation;
      await creditShares(
        db,
        listing.corporationId,
        listing.sellerCharacterId,
        listing.sharesRemaining,
        { $set: { updatedAt: now } },
        { pricePerShare: returnPrice }
      );
    }
  }

  // Notify buyers
  if (notifyKeys.size > 0) {
    const buyerCharIds = [...new Set([...notifyKeys.values()].map((v) => v.charId))];
    const buyerChars = await db
      .collection<Character>("characters")
      .find({ _id: { $in: buyerCharIds } }, { projection: { _id: 1, userId: 1 } })
      .toArray();
    const charToUser = new Map(buyerChars.map((c) => [c._id.toString(), c.userId]));

    const notifications: Omit<Notification, "_id">[] = [];
    for (const { charId, listingId } of notifyKeys.values()) {
      const userId = charToUser.get(charId.toString());
      if (!userId) continue;
      notifications.push({
        userId,
        type: "share_offer_expired",
        title: "Share listing expired",
        message:
          "A private share listing you made an offer on has expired. Your escrow has been refunded.",
        read: false,
        metadata: { listingId },
        createdAt: now,
      } as Omit<Notification, "_id">);
    }
    if (notifications.length > 0) {
      // notifications array is Omit<Notification, "_id">[] — insertMany expects OptionalUnlessRequiredId
      /* eslint-disable @typescript-eslint/no-explicit-any */
      await db
        .collection<Omit<Notification, "_id">>("notifications")
        .insertMany(notifications as any);
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }
  }
}
