import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { fillOrderSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { assertCeoTradeNotBlocked } from "@/lib/corporations/commands/privatization/openVoteGuard";
import type { Character, Corporation, IndexFund, ShareOrder, User } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import {
  creditShares,
  creditSharesToImperial,
  creditSharesToCorp,
  debitShares,
  debitSharesFromCorp,
  creditSharesToFund,
  debitSharesFromFund,
  debitSharesFromImperial,
} from "@/lib/corporations/shareholderOps";
import {
  creditSellerFundProceeds,
  reconcileTotalSharesAfterFill,
  resolveCharName,
  settleBuyOrderFill,
} from "@/lib/corporations/commands/shareTrading/fillShareOrderSettlement";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { newCharacterTransferBarrierResponse } from "@/lib/api/newCharacterTransferBarrier";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  buildPersonalBalanceInc,
  getHomeCurrency,
  loadCharacterFxRate,
} from "@/lib/currency/characterFunds";
import {
  atomicallyDebitCharacterCash,
  refundCharacterCash,
  atomicallyDebitImperialCash,
  refundImperialCash,
  atomicallyDebitCorpLiquidCapital,
  refundCorpLiquidCapital,
} from "@/lib/financialTxLog/atomicCashGuard";
import {
  beginShareFillAttempt,
  buildShareFillClaimFilter,
  buildShareFillFingerprint,
  buildShareFillRouteClaimPipeline,
  collectShareFillAuditRows,
  insertShareFillAuditRows,
  markShareFillMoneyCommitted,
  prepareShareFillClaim,
  settleShareFillAttempt,
  type ShareFillAuditPlan,
  type ShareFillPlacerKind,
} from "@/lib/corporations/commands/shareTrading/shareFillAudit";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  estimateCorpWalletSpend,
  getCorpFxRate,
  loadFxRatesRecord,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { distributeConversionSpread } from "@/lib/currency/marketMaker";
import { notifyHostileTakeoverThresholdIfEligible } from "@/lib/corporations/hostileTakeoverNotifications";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { assertCeoAcquisitionWithinCap } from "@/lib/corporations/ceoShareAcquisitionCap";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";
import { debitFundHoldingShares, upsertFundHoldingShares } from "@/lib/indexFunds/fundQueries";

interface RouteParams {
  params: Promise<{ id: string; orderId: string }>;
}

/**
 * POST /api/corporations/[id]/shares/orders/[orderId]/fill
 * Directly fill (or partially fill) another player's open order.
 *
 * Fill a sell order → filler is buying: cash from filler, shares to filler, cash to seller.
 *   With fillAsCorporation, cash comes from the CEO's corp liquid capital and shares credit to that corp.
 * Fill a buy order  → filler is selling: shares from filler, shares to buyer, escrow to filler.
 */
export async function fillShareOrder(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { id, orderId } = await params;

    const parsed = await parseJsonBody(request, fillOrderSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { shares, fillAsCorporation } = parsed.data;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;
    const turnGuard = await rejectDuringTurn(db);
    if (turnGuard) return turnGuard;

    if (!ObjectId.isValid(orderId)) {
      return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
    }

    const loadedOrder = await db
      .collection<ShareOrder>("shareOrders")
      .findOne({ _id: new ObjectId(orderId) });

    if (!loadedOrder) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    // Repair a stranded legacy claim and recover the stamped prior attempt's
    // audit before validating: a stuck `filled` order is fillable again here.
    const prepared = await prepareShareFillClaim(db, loadedOrder);
    const order = prepared.order;
    const orderCharacterId = order.characterId;
    // Fund buy orders (bids) can be peer-filled: the filler sells their shares and
    // receives the fund's escrowed cash. Orders with no placer at all cannot be filled.
    if (!orderCharacterId && !order.placerFundId) {
      return NextResponse.json({ error: "This order cannot be filled" }, { status: 400 });
    }
    if (order.status !== "open")
      return NextResponse.json({ error: "Order is not open" }, { status: 400 });
    if (shares > order.sharesRemaining)
      return NextResponse.json(
        { error: `Only ${order.sharesRemaining.toLocaleString()} shares remaining in this order` },
        { status: 400 }
      );

    if (fillAsCorporation && order.type !== "sell") {
      return NextResponse.json(
        { error: "Corporation fills are only supported when buying from a sell order" },
        { status: 400 }
      );
    }

    // Resolve filler identity (regular or imperial)
    const userDoc = await db
      .collection<User>("users")
      .findOne({ _id: new ObjectId(auth.user.userId) });
    const isImperialFiller =
      userDoc?.activeCharacterType === "imperial" && !!userDoc?.activeImperialCharacterId;

    let fillerId: ObjectId;
    let fillerCollectionName: "characters" | "imperialCharacters";
    let fillerCountryId: string;
    let fillerName: string;
    let fillerCreated: { createdTurn?: number | null; createdAt?: Date | string | null };

    if (isImperialFiller) {
      const imperial = await db.collection<ImperialCharacter>("imperialCharacters").findOne({
        _id: userDoc!.activeImperialCharacterId!,
        userId: new ObjectId(auth.user.userId),
      });
      if (!imperial) {
        return NextResponse.json({ error: "Imperial character not found" }, { status: 404 });
      }
      fillerId = imperial._id;
      fillerCollectionName = "imperialCharacters";
      fillerCountryId = imperial.countryId;
      fillerName = imperial.name;
      fillerCreated = imperial;
    } else {
      const characterQuery = userDoc?.activeCharacterId
        ? { _id: userDoc.activeCharacterId, userId: new ObjectId(auth.user.userId) }
        : { userId: new ObjectId(auth.user.userId) };
      const character = await db.collection<Character>("characters").findOne(characterQuery);
      if (!character) {
        return NextResponse.json({ error: "Character not found" }, { status: 404 });
      }
      fillerId = character._id;
      fillerCollectionName = "characters";
      fillerCountryId = character.countryId;
      fillerName = character.name;
      fillerCreated = character;
    }

    // A fill moves value between players either way — cash to the poster on a
    // sell order, shares (bought with a confederate's escrow) on a buy order.
    // Checked on the resolved actor even when the fill runs as a corporation:
    // a fresh account's corp can only hold what the account put in.
    const barrier = await newCharacterTransferBarrierResponse(fillerCreated);
    if (barrier) return barrier;

    if (
      !fillAsCorporation &&
      orderCharacterId &&
      orderCharacterId.toString() === fillerId.toString()
    ) {
      return NextResponse.json({ error: "Cannot fill your own order" }, { status: 400 });
    }

    // Self-dealing guard: CEO cannot fill their own corporation's buy order
    if (order.type === "buy" && order.placerCorporationId) {
      const buyingCorp = await db
        .collection<Corporation>("corporations")
        .findOne({ _id: order.placerCorporationId }, { projection: { ceoId: 1 } });
      if (buyingCorp?.ceoId?.toString() === fillerId.toString()) {
        return NextResponse.json(
          { error: "A corporation's CEO cannot fill that corporation's own buy orders" },
          { status: 400 }
        );
      }
    }

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;

    // Ensure order belongs to this corporation
    if (order.corporationId.toString() !== resolved.corporation._id.toString()) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const { corporation } = resolved;

    // CEO trade lock — fillerId is the character executing the fill on the
    // corp whose shares are being traded. Must come AFTER `corporation` is
    // available from the resolve step above.
    if (!fillAsCorporation) {
      const tradeLock = await assertCeoTradeNotBlocked(db, corporation, fillerId);
      if (tradeLock.blocked) {
        return NextResponse.json({ error: tradeLock.error }, { status: tradeLock.status });
      }
    }

    // CEO self-acquisition cap: filling a SELL order means the filler ACQUIRES
    // `shares`. If that filler is the corp's own CEO, the buy counts against the
    // 10%/120-turn window. (Filling a BUY order = the filler sells; the placer's
    // acquisition was already capped at placeShareOrder.) Checked before any FX
    // work so it fails fast.
    if (order.type === "sell" && !fillAsCorporation) {
      const ceoCap = await assertCeoAcquisitionWithinCap(
        db,
        corporation,
        fillerId,
        isImperialFiller ? "imperialCharacterId" : "characterId",
        shares,
        await getCurrentTurn(db)
      );
      if (ceoCap) return NextResponse.json({ error: ceoCap.error }, { status: ceoCap.status });
    }
    const now = new Date();
    // order.pricePerShare and order.escrowAmount are both stored in the target
    // corp's liquidCurrencyCode (Option B, v0.2.6). We compute `total` as ₳ so
    // the wallet debits/credits downstream can hop through the anchor; the
    // partial-fill update at the bottom of this handler stays in local because
    // `newSharesRemaining * pricePerShare` matches the stored escrow unit.
    const targetFxRate = await getCorpFxRate(db, corporation);
    const totalLocal = shares * order.pricePerShare;
    const total = corpLiquidCapitalToAnchor(totalLocal, corporation, targetFxRate);
    const forexEnabled = await isForexEnabled();
    const fillerHomeCurrency = getHomeCurrency({ countryId: fillerCountryId });
    const currentTurn = await getCurrentTurn(db);
    const sellerFund =
      order.type === "sell" && order.placerFundId
        ? await db.collection<IndexFund>("indexFunds").findOne({ _id: order.placerFundId })
        : null;
    if (order.type === "sell" && order.placerFundId && !sellerFund) {
      return NextResponse.json({ error: "Liquidity-provider fund not found" }, { status: 404 });
    }

    // Load filler FX rate upfront — used in both fill paths
    let fillerFxRate = 1.0;
    if (forexEnabled) {
      const fxResult = await loadCharacterFxRate(db, fillerHomeCurrency);
      if (!fxResult.ok) {
        return NextResponse.json(
          { error: "Exchange rate unavailable, try again shortly" },
          { status: 503 }
        );
      }
      fillerFxRate = fxResult.rate;
    }
    const totalInFillerHome = total * fillerFxRate;

    let buyingCorpForSellFill: Corporation | null = null;
    let buyOrderBuyerCorp: Pick<Corporation, "_id" | "name"> | null = null;
    // Cross-currency FX spread the corp filler pays when buying into a sell order
    // (the seller receives only the share value, so the markup is consumed here).
    // Distributed at the single success return so a throw — which refunds the
    // buyer's full cost — can never leave the spread double-counted.
    let fillerBuyConversionSpread: { fee: number; from: CurrencyCode; to: CurrencyCode } | null =
      null;

    if (order.type === "sell" && fillAsCorporation) {
      const buyingCorp = await db
        .collection<Corporation>("corporations")
        .findOne({ ceoId: fillerId, ceoVacant: { $ne: true } });
      if (!buyingCorp) {
        return NextResponse.json(
          { error: "You must be an active CEO to fill orders on behalf of a corporation" },
          { status: 403 }
        );
      }
      if (buyingCorp._id.equals(corporation._id)) {
        return NextResponse.json(
          { error: "A corporation cannot purchase shares in itself via the order book" },
          { status: 400 }
        );
      }
      if (buyingCorp.countryOwnerId) {
        return NextResponse.json(
          { error: "National corporations cannot hold equity positions" },
          { status: 400 }
        );
      }
      if (order.placerCorporationId?.equals(buyingCorp._id)) {
        return NextResponse.json(
          { error: "A corporation cannot fill its own sell order" },
          { status: 400 }
        );
      }
      if (
        !order.placerCorporationId &&
        orderCharacterId &&
        orderCharacterId.equals(buyingCorp.ceoId)
      ) {
        return NextResponse.json({ error: "Cannot fill your own order" }, { status: 400 });
      }
      buyingCorpForSellFill = buyingCorp;
    } else if (order.type === "buy") {
      if (order.placerCorporationId) {
        buyOrderBuyerCorp = await db
          .collection<Corporation>("corporations")
          .findOne({ _id: order.placerCorporationId }, { projection: { _id: 1, name: 1 } });
        if (!buyOrderBuyerCorp) {
          return NextResponse.json({ error: "Buying corporation not found" }, { status: 404 });
        }
      }

      const fillerEntry = corporation.shareholders?.find((sh) =>
        isImperialFiller
          ? sh.imperialCharacterId?.toString() === fillerId.toString()
          : sh.characterId?.toString() === fillerId.toString()
      );
      const fillerOwnedShares = fillerEntry?.shares ?? 0;
      const openSellOrders = await db
        .collection<ShareOrder>("shareOrders")
        .find({
          corporationId: corporation._id,
          characterId: fillerId,
          type: "sell",
          status: "open",
        })
        .toArray();
      const alreadyReserved = openSellOrders.reduce(
        (sum, o) => sum + (o.sharesDebitedAtCreation ? 0 : o.sharesRemaining),
        0
      );
      const availableShares = fillerOwnedShares - alreadyReserved;

      if (availableShares < shares) {
        return NextResponse.json(
          {
            error: `Only ${availableShares.toLocaleString()} shares available (${alreadyReserved.toLocaleString()} reserved in open orders)`,
          },
          { status: 400 }
        );
      }
    }

    // Pin every audit-plan figure before the claim (issue #1672). Seller
    // proceeds, display names, and the corp-filler FX estimate are pure reads,
    // so hoisting them ahead of the claim changes no money behavior; the
    // resume plan then carries the exact first-attempt figures and recovery
    // never reprices from post-fill state.
    const buyingCurrency = (
      buyingCorpForSellFill
        ? (resolveCorpLiquidCurrencyCode(buyingCorpForSellFill) ?? "USD")
        : "USD"
    ) as CurrencyCode;
    const targetCurrency = (resolveCorpLiquidCurrencyCode(corporation) ?? "USD") as CurrencyCode;
    let pinnedSellerName: string | null = null;
    let pinnedSellerAmount = 0;
    let pinnedSellerCurrency: CurrencyCode | null = null;
    let pinnedBuyerName: string | null = null;
    let corpFillCostInBuyerCapital = 0;
    if (order.type === "sell") {
      if (order.placerFundId) {
        pinnedSellerName = sellerFund?.name ?? "Index fund";
      } else if (order.placerCorporationId) {
        const sellerCorp = await db
          .collection<Corporation>("corporations")
          .findOne({ _id: order.placerCorporationId });
        const sellerFxRate = await getCorpFxRate(db, sellerCorp ?? {});
        pinnedSellerName = sellerCorp?.name ?? "Unknown corporation";
        pinnedSellerAmount = anchorToCorpLiquidCapital(total, sellerCorp ?? {}, sellerFxRate);
        pinnedSellerCurrency = (resolveCorpLiquidCurrencyCode(sellerCorp ?? {}) ??
          "USD") as CurrencyCode;
      } else {
        const seller = await db
          .collection<Character>("characters")
          .findOne({ _id: orderCharacterId }, { projection: { countryId: 1, name: 1 } });
        pinnedSellerName = seller?.name ?? "Unknown character";
        pinnedSellerCurrency = seller ? getHomeCurrency(seller as Character) : fillerHomeCurrency;
        let sellerFxRate = 1.0;
        if (forexEnabled) {
          const sellerFxResult = await loadCharacterFxRate(db, pinnedSellerCurrency);
          if (!sellerFxResult.ok) {
            throw new Error("Exchange rate unavailable for seller");
          }
          sellerFxRate = sellerFxResult.rate;
        }
        pinnedSellerAmount = total * sellerFxRate;
      }
      if (fillAsCorporation && buyingCorpForSellFill) {
        const buyerFxRate = await getCorpFxRate(db, buyingCorpForSellFill);
        const fxRates = await loadFxRatesRecord(db);
        const corpPurchaseEstimate = estimateCorpWalletSpend({
          requiredAmount: totalLocal,
          availableBalance: buyingCorpForSellFill.liquidCapital ?? 0,
          fromCurrency: buyingCurrency,
          toCurrency: targetCurrency,
          rates: fxRates,
        });
        if (!corpPurchaseEstimate) {
          return NextResponse.json(
            { error: "Exchange rate unavailable, try again shortly" },
            { status: 503 }
          );
        }
        corpFillCostInBuyerCapital =
          buyingCurrency !== targetCurrency
            ? corpPurchaseEstimate.spendAmount
            : anchorToCorpLiquidCapital(total, buyingCorpForSellFill, buyerFxRate);
        if (buyingCurrency !== targetCurrency) {
          fillerBuyConversionSpread = {
            fee: corpPurchaseEstimate.spreadFee,
            from: buyingCurrency,
            to: targetCurrency,
          };
        }
      }
    } else if (!order.placerFundId && !order.placerCorporationId) {
      pinnedBuyerName = await resolveCharName(db, orderCharacterId!, false);
    }

    const placerKind: ShareFillPlacerKind = order.placerFundId
      ? "fund"
      : order.placerCorporationId
        ? "corporation"
        : "character";
    const placerName =
      order.type === "sell"
        ? (pinnedSellerName ?? "Unknown character")
        : order.placerFundId
          ? "Index fund"
          : (buyOrderBuyerCorp?.name ?? pinnedBuyerName ?? "Unknown corporation");
    const fillerIsCorpFill = fillAsCorporation && !!buyingCorpForSellFill;
    const placerIdHex =
      placerKind === "fund"
        ? order.placerFundId!.toHexString()
        : placerKind === "corporation"
          ? order.placerCorporationId!.toHexString()
          : orderCharacterId!.toHexString();
    const fillPlan: ShareFillAuditPlan = {
      version: 1,
      orderIdHex: order._id.toHexString(),
      corpIdHex: corporation._id.toHexString(),
      corpCcy: corporation.liquidCurrencyCode,
      orderType: order.type,
      shares,
      pricePerShare: order.pricePerShare,
      totalAnchor: total,
      turn: currentTurn,
      nowIso: now.toISOString(),
      preClaimRemaining: order.sharesRemaining,
      filler: {
        idHex: fillerId.toHexString(),
        collection: fillerIsCorpFill ? "corporations" : fillerCollectionName,
        name: fillerIsCorpFill ? buyingCorpForSellFill!.name : fillerName,
        homeCurrency: fillerIsCorpFill ? buyingCurrency : fillerHomeCurrency,
        imperial: isImperialFiller,
      },
      fillerAmount: fillerIsCorpFill ? corpFillCostInBuyerCapital : totalInFillerHome,
      placerKind,
      placerIdHex,
      placerName,
      ...(order.type === "sell" && placerKind !== "fund" && pinnedSellerCurrency
        ? { sellerAmount: pinnedSellerAmount, sellerCurrency: pinnedSellerCurrency }
        : {}),
      fundTx: order.type === "sell" && placerKind === "fund",
      moneyCommitted: false,
    };
    const fillKey = await beginShareFillAttempt(
      db,
      fillPlan,
      buildShareFillFingerprint({
        orderId: order._id,
        fillerId,
        shares,
        pricePerShare: order.pricePerShare,
      })
    );

    const claimedOrder = await db
      .collection<ShareOrder>("shareOrders")
      .findOneAndUpdate(
        buildShareFillClaimFilter(order._id, shares),
        buildShareFillRouteClaimPipeline({ shares, fillKey, now }),
        { returnDocument: "after" }
      );

    if (!claimedOrder) {
      await settleShareFillAttempt(db, fillKey, "failed", "share-fill:claim-never-landed");
      return NextResponse.json(
        { error: "Order changed before this fill could be applied" },
        { status: 409 }
      );
    }

    const restoreClaimedOrder = async () => {
      const restoreFields: Record<string, unknown> = {
        sharesRemaining: order.sharesRemaining,
        escrowAmount: order.escrowAmount,
        status: order.status,
        updatedAt: new Date(),
      };
      if (order.escrowAnchor !== undefined) restoreFields.escrowAnchor = order.escrowAnchor;
      if (order.lastShareFillKey !== undefined) {
        restoreFields.lastShareFillKey = order.lastShareFillKey;
      }
      const restoreUpdate: {
        $set: Record<string, unknown>;
        $unset?: Record<string, "" | 1 | true>;
      } = { $set: restoreFields };
      if (order.lastShareFillKey === undefined) {
        restoreUpdate.$unset = { lastShareFillKey: "" };
      }
      await db.collection<ShareOrder>("shareOrders").updateOne({ _id: order._id }, restoreUpdate);
    };

    const sellerCharacterAvgCost = orderCharacterId
      ? corporation.shareholders?.find((sh) => sh.characterId?.equals(orderCharacterId))
          ?.avgCostPerShare
      : undefined;
    const fundFillPriceAnchor = shares > 0 ? total / shares : 0;
    let sellerFundInventoryDebited = false;
    let sellerFundCashCredited = false;

    const debitSellerFundInventory = async (): Promise<boolean> => {
      if (!order.placerFundId) return true;
      const remaining = await debitSharesFromFund(
        db,
        corporation._id,
        order.placerFundId,
        shares,
        { $set: { updatedAt: now } },
        { requireSufficient: true }
      );
      if (remaining < 0) return false;
      const holdingsDebited = await debitFundHoldingShares(
        db,
        order.placerFundId,
        corporation._id,
        shares,
        fundFillPriceAnchor
      );
      if (!holdingsDebited) {
        await creditSharesToFund(
          db,
          corporation._id,
          order.placerFundId,
          shares,
          fundFillPriceAnchor,
          { $set: { updatedAt: new Date() } }
        );
        return false;
      }
      sellerFundInventoryDebited = true;
      return true;
    };

    // Both seller-leg sites (corporation-buyer below, character-buyer further
    // down) settle the fund proceeds through one shared helper so the
    // committed-path-only ledger row is identical at both: emitted after the
    // cash credit lands, inside the guarded fill that rolls the cash back on
    // any later failure.
    const creditSellerFund = async (buyer: {
      type: "corporation" | "character";
      id: ObjectId;
      name: string;
    }): Promise<void> => {
      if (!order.placerFundId) return;
      await creditSellerFundProceeds({
        db,
        fundId: order.placerFundId,
        fundName: sellerFund?.name ?? "Index fund",
        fundAnchorCurrency: sellerFund?.anchorCurrencyCode ?? "USD",
        total,
        buyer,
        corporationId: corporation._id,
        orderId: order._id,
        shares,
        pricePerShare: order.pricePerShare,
        currentTurn,
        now,
      });
      sellerFundCashCredited = true;
    };

    // The fund-transaction row the removed `recordSellerFundSale` wrote is now
    // part of the convergent post-commit audit (identical values, keyed _id):
    // a post-commit duplicate converges instead of double-inserting. The
    // cash credit above stays on the legacy money path.
    const rollbackSellerFund = async (): Promise<void> => {
      if (!order.placerFundId) return;
      if (sellerFundCashCredited) {
        await db
          .collection<IndexFund>("indexFunds")
          .updateOne(
            { _id: order.placerFundId },
            { $inc: { cashAnchor: -total }, $set: { updatedAt: new Date() } }
          );
        sellerFundCashCredited = false;
      }
      if (sellerFundInventoryDebited) {
        await creditSharesToFund(
          db,
          corporation._id,
          order.placerFundId,
          shares,
          fundFillPriceAnchor,
          { $set: { updatedAt: new Date() } }
        );
        await upsertFundHoldingShares(
          db,
          order.placerFundId,
          corporation._id,
          shares,
          fundFillPriceAnchor
        );
        sellerFundInventoryDebited = false;
      }
    };

    if (order.type === "sell") {
      // Post-debit filler balance pinned for the audit plan (balanceAfter).
      let fillerBalanceAfter: number | undefined;
      if (fillAsCorporation) {
        // Filler is a corporation (CEO's company) — pay from liquidCapital, credit shares to that corp.
        const buyingCorp = buyingCorpForSellFill;
        if (!buyingCorp) throw new Error("Validated buying corporation missing");

        // Pinned pre-claim by the audit-plan hoist above (same FX estimate the
        // legacy path computed here).
        const costInBuyerCapital = corpFillCostInBuyerCapital;
        let sellerSharesDebited = false;
        let buyerSharesCredited = false;
        let sellerCapitalCredited = false;
        let sellerHomeCredited = false;

        // Atomic balance-gated debit on the buying corp's liquidCapital.
        // Replaces the read-then-write check + naïve $inc that allowed
        // concurrent corp fills to over-deduct or split-debit. The user-
        // facing message preserves the cross-currency display from the
        // pre-fix path so admins see anchor + local amounts.
        const corpDebit = await atomicallyDebitCorpLiquidCapital(
          db,
          buyingCorp._id,
          costInBuyerCapital
        );
        if (!corpDebit.ok) {
          await restoreClaimedOrder();
          await settleShareFillAttempt(db, fillKey, "failed", "share-fill:claim-restored");
          // Honor liquidCurrencyCode first (A28/A32) so a corp that relocated
          // without a liquidCurrencyCode backfill still shows the correct symbol.
          const buySym = CURRENCY_SYMBOLS[buyingCurrency] ?? "$";
          const targetSym = CURRENCY_SYMBOLS[targetCurrency] ?? "$";
          const costStr = total.toLocaleString(undefined, { minimumFractionDigits: 2 });
          const adjustedStr = costInBuyerCapital.toLocaleString(undefined, {
            minimumFractionDigits: 2,
          });
          const haveStr = (buyingCorp.liquidCapital ?? 0).toLocaleString(undefined, {
            minimumFractionDigits: 2,
          });
          const currencyNote =
            buyingCurrency !== targetCurrency
              ? ` (${buySym}${adjustedStr} ${buyingCurrency} incl. FX, corp has ${buySym}${haveStr} ${buyingCurrency})`
              : "";
          return NextResponse.json(
            {
              error:
                buyingCurrency !== targetCurrency
                  ? `Insufficient funds. Need ${targetSym}${costStr}${currencyNote}`
                  : `Insufficient funds. Need ${targetSym}${costStr}, corp has ${buySym}${haveStr} ${buyingCurrency}`,
            },
            { status: 400 }
          );
        }

        try {
          if (order.placerFundId) {
            const debited = await debitSellerFundInventory();
            if (!debited) {
              await restoreClaimedOrder();
              await settleShareFillAttempt(db, fillKey, "failed", "share-fill:claim-restored");
              await refundCorpLiquidCapital(db, buyingCorp._id, costInBuyerCapital);
              return NextResponse.json(
                { error: "Liquidity provider no longer has enough shares" },
                { status: 409 }
              );
            }
          } else if (!order.placerCorporationId && order.sharesDebitedAtCreation !== true) {
            // Skip when sharesDebitedAtCreation: placement already took the shares.
            // Legacy character sells without that flag still debit here.
            const remainingSellerShares = await debitShares(
              db,
              corporation._id,
              orderCharacterId!,
              shares,
              {
                $set: { updatedAt: now },
              },
              { requireSufficient: true }
            );
            if (remainingSellerShares < 0) {
              await restoreClaimedOrder();
              await settleShareFillAttempt(db, fillKey, "failed", "share-fill:claim-restored");
              await refundCorpLiquidCapital(db, buyingCorp._id, costInBuyerCapital);
              return NextResponse.json(
                { error: "Seller no longer has enough shares to settle this order" },
                { status: 409 }
              );
            }
            sellerSharesDebited = true;
          }

          await creditSharesToCorp(
            db,
            corporation._id,
            buyingCorp._id,
            shares,
            order.pricePerShare,
            { $set: { updatedAt: now } }
          );
          buyerSharesCredited = true;

          // Money only from here: seller proceeds and names are pinned
          // pre-claim on the audit plan, and the audit rows are written
          // convergently after the commit below, never inside this try.
          if (order.placerFundId) {
            await creditSellerFund({
              type: "corporation",
              id: buyingCorp._id,
              name: buyingCorp.name,
            });
          } else if (order.placerCorporationId) {
            await db
              .collection<Corporation>("corporations")
              .updateOne(
                { _id: order.placerCorporationId },
                { $inc: { liquidCapital: pinnedSellerAmount }, $set: { updatedAt: now } }
              );
            sellerCapitalCredited = true;
          } else {
            await db.collection<Character>("characters").updateOne(
              { _id: orderCharacterId },
              {
                $inc: buildPersonalBalanceInc(
                  pinnedSellerAmount,
                  pinnedSellerCurrency ?? fillerHomeCurrency,
                  forexEnabled
                ),
                $set: { updatedAt: now },
              }
            );
            sellerHomeCredited = true;
          }
          fillerBalanceAfter = corpDebit.newBalance;
        } catch (err) {
          await rollbackSellerFund();
          if (sellerHomeCredited && pinnedSellerCurrency) {
            await db.collection<Character>("characters").updateOne(
              { _id: orderCharacterId! },
              {
                $inc: buildPersonalBalanceInc(
                  -pinnedSellerAmount,
                  pinnedSellerCurrency,
                  forexEnabled
                ),
                $set: { updatedAt: new Date() },
              }
            );
          }
          if (sellerCapitalCredited && order.placerCorporationId) {
            await db
              .collection<Corporation>("corporations")
              .updateOne(
                { _id: order.placerCorporationId },
                { $inc: { liquidCapital: -pinnedSellerAmount }, $set: { updatedAt: new Date() } }
              );
          }
          if (buyerSharesCredited) {
            await debitSharesFromCorp(
              db,
              corporation._id,
              buyingCorp._id,
              shares,
              { $set: { updatedAt: new Date() } },
              { requireSufficient: true }
            );
          }
          if (sellerSharesDebited) {
            await creditShares(
              db,
              corporation._id,
              orderCharacterId!,
              shares,
              { $set: { updatedAt: new Date() } },
              { pricePerShare: sellerCharacterAvgCost ?? order.pricePerShare }
            );
          }
          await restoreClaimedOrder();
          await refundCorpLiquidCapital(db, buyingCorp._id, costInBuyerCapital);
          throw err;
        }
      } else {
        // Filler is buying as a character — debit shares from seller, credit to filler.
        // Atomic balance-gated debit on filler wallet (regular or imperial).
        // Pre-fix used getPersonalBalance() against a cached doc and a
        // separate naïve $inc — same race shape the bond-buy fix closed.
        let sellerSharesDebited = false;
        let buyerSharesCredited = false;
        let sellerCapitalCredited = false;
        let sellerHomeCredited = false;
        const debitResult = isImperialFiller
          ? await atomicallyDebitImperialCash(
              db,
              fillerId,
              fillerHomeCurrency,
              totalInFillerHome,
              forexEnabled
            )
          : await atomicallyDebitCharacterCash(
              db,
              fillerId,
              fillerHomeCurrency,
              totalInFillerHome,
              forexEnabled
            );
        if (!debitResult.ok) {
          await restoreClaimedOrder();
          await settleShareFillAttempt(db, fillKey, "failed", "share-fill:claim-restored");
          return NextResponse.json({ error: "Insufficient funds" }, { status: 400 });
        }

        try {
          if (order.placerFundId) {
            const debited = await debitSellerFundInventory();
            if (!debited) {
              await restoreClaimedOrder();
              await settleShareFillAttempt(db, fillKey, "failed", "share-fill:claim-restored");
              if (isImperialFiller) {
                await refundImperialCash(
                  db,
                  fillerId,
                  fillerHomeCurrency,
                  totalInFillerHome,
                  forexEnabled
                );
              } else {
                await refundCharacterCash(
                  db,
                  fillerId,
                  fillerHomeCurrency,
                  totalInFillerHome,
                  forexEnabled
                );
              }
              return NextResponse.json(
                { error: "Liquidity provider no longer has enough shares" },
                { status: 409 }
              );
            }
          } else if (!order.placerCorporationId && order.sharesDebitedAtCreation !== true) {
            // Skip when sharesDebitedAtCreation: placement already took the shares.
            // Legacy character sells without that flag still debit here.
            const remainingSellerShares = await debitShares(
              db,
              corporation._id,
              orderCharacterId!,
              shares,
              {
                $set: { updatedAt: now },
              },
              { requireSufficient: true }
            );
            if (remainingSellerShares < 0) {
              await restoreClaimedOrder();
              await settleShareFillAttempt(db, fillKey, "failed", "share-fill:claim-restored");
              if (isImperialFiller) {
                await refundImperialCash(
                  db,
                  fillerId,
                  fillerHomeCurrency,
                  totalInFillerHome,
                  forexEnabled
                );
              } else {
                await refundCharacterCash(
                  db,
                  fillerId,
                  fillerHomeCurrency,
                  totalInFillerHome,
                  forexEnabled
                );
              }
              return NextResponse.json(
                { error: "Seller no longer has enough shares to settle this order" },
                { status: 409 }
              );
            }
            sellerSharesDebited = true;
          }
          if (isImperialFiller) {
            await creditSharesToImperial(
              db,
              corporation._id,
              fillerId,
              shares,
              { $set: { updatedAt: now } },
              { pricePerShare: order.pricePerShare }
            );
          } else {
            await creditShares(
              db,
              corporation._id,
              fillerId,
              shares,
              { $set: { updatedAt: now } },
              { pricePerShare: order.pricePerShare }
            );
          }
          buyerSharesCredited = true;

          // Money only from here: seller proceeds and names are pinned
          // pre-claim on the audit plan, and the audit rows are written
          // convergently after the commit below, never inside this try.
          if (order.placerFundId) {
            await creditSellerFund({ type: "character", id: fillerId, name: fillerName });
          } else if (order.placerCorporationId) {
            await db
              .collection<Corporation>("corporations")
              .updateOne(
                { _id: order.placerCorporationId },
                { $inc: { liquidCapital: pinnedSellerAmount }, $set: { updatedAt: now } }
              );
            sellerCapitalCredited = true;
          } else {
            await db.collection<Character>("characters").updateOne(
              { _id: orderCharacterId },
              {
                $inc: buildPersonalBalanceInc(
                  pinnedSellerAmount,
                  pinnedSellerCurrency ?? fillerHomeCurrency,
                  forexEnabled
                ),
                $set: { updatedAt: now },
              }
            );
            sellerHomeCredited = true;
          }
          fillerBalanceAfter = debitResult.newBalance;
        } catch (err) {
          await rollbackSellerFund();
          if (sellerHomeCredited && pinnedSellerCurrency) {
            await db.collection<Character>("characters").updateOne(
              { _id: orderCharacterId! },
              {
                $inc: buildPersonalBalanceInc(
                  -pinnedSellerAmount,
                  pinnedSellerCurrency,
                  forexEnabled
                ),
                $set: { updatedAt: new Date() },
              }
            );
          }
          if (sellerCapitalCredited && order.placerCorporationId) {
            await db
              .collection<Corporation>("corporations")
              .updateOne(
                { _id: order.placerCorporationId },
                { $inc: { liquidCapital: -pinnedSellerAmount }, $set: { updatedAt: new Date() } }
              );
          }
          if (buyerSharesCredited) {
            if (isImperialFiller) {
              await debitSharesFromImperial(
                db,
                corporation._id,
                fillerId,
                shares,
                { $set: { updatedAt: new Date() } },
                { requireSufficient: true }
              );
            } else {
              await debitShares(
                db,
                corporation._id,
                fillerId,
                shares,
                { $set: { updatedAt: new Date() } },
                { requireSufficient: true }
              );
            }
          }
          if (sellerSharesDebited) {
            await creditShares(
              db,
              corporation._id,
              orderCharacterId!,
              shares,
              { $set: { updatedAt: new Date() } },
              { pricePerShare: sellerCharacterAvgCost ?? order.pricePerShare }
            );
          }
          await restoreClaimedOrder();
          if (isImperialFiller) {
            await refundImperialCash(
              db,
              fillerId,
              fillerHomeCurrency,
              totalInFillerHome,
              forexEnabled
            );
          } else {
            await refundCharacterCash(
              db,
              fillerId,
              fillerHomeCurrency,
              totalInFillerHome,
              forexEnabled
            );
          }
          throw err;
        }
      }
      // Money committed. Write the audit convergently under the attempt key:
      // a crash from here on is repaired by recovery, and an audit failure
      // leaves the receipt in_progress for that recovery instead of rolling
      // back moved money over a missing row.
      await markShareFillMoneyCommitted(db, fillKey, fillerBalanceAfter);
      fillPlan.fillerBalanceAfter = fillerBalanceAfter;
      const sellAuditOutcome = await insertShareFillAuditRows(
        db,
        fillKey,
        collectShareFillAuditRows(fillPlan)
      );
      if (sellAuditOutcome !== "failed") {
        await settleShareFillAttempt(db, fillKey, "completed");
      }
    } else {
      // Filler is selling — buyer's money is in escrow
      const buyOrderErrorResponse = await settleBuyOrderFill({
        db,
        corporation,
        order,
        orderCharacterId,
        buyOrderBuyerCorp,
        shares,
        total,
        totalInFillerHome,
        fillerId,
        fillerName,
        fillerCollectionName,
        fillerHomeCurrency,
        isImperialFiller,
        forexEnabled,
        currentTurn,
        now,
        restoreClaimedOrder,
        fillKey,
        plan: fillPlan,
      });
      if (buyOrderErrorResponse) return buyOrderErrorResponse;
    }

    // Peer-fill history rows are part of the convergent keyed audit each path
    // writes (sell fills above, buy fills inside settleBuyOrderFill), built
    // from the pinned plan names so recovery reproduces them exactly.
    void notifyHostileTakeoverThresholdIfEligible(db, corporation._id);

    // Post-fill invariant: recompute totalShares from live positions and
    // atomically correct any drift (best-effort, non-fatal).
    await reconcileTotalSharesAfterFill(db, corporation._id);

    // Fill fully committed — route the corp filler's FX spread into the CB
    // system (reserve → traded-corp currency CB; revenue → filler-currency CB).
    if (fillerBuyConversionSpread) {
      await distributeConversionSpread(
        db,
        fillerBuyConversionSpread.fee,
        fillerBuyConversionSpread.from,
        fillerBuyConversionSpread.to
      );
    }

    return NextResponse.json({
      success: true,
      sharesFilled: shares,
      total: Math.round(total * 100) / 100,
      spreadPaid: fillerBuyConversionSpread
        ? Math.round(fillerBuyConversionSpread.fee * 100) / 100
        : 0,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
