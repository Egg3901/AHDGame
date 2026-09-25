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
  emitSellerFundProceedsRow,
  reconcileTotalSharesAfterFill,
  resolveCharName,
  settleBuyOrderFill,
} from "@/lib/corporations/commands/shareTrading/fillShareOrderSettlement";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { newCharacterTransferBarrierResponse } from "@/lib/api/newCharacterTransferBarrier";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import {
  beginShareFillAttempt,
  buildShareFillClaimFilter,
  buildShareFillFingerprint,
  buildShareFillRouteClaimPipeline,
  collectShareFillAuditRows,
  insertShareFillAuditRows,
  prepareShareFillClaim,
  settleShareFillAttempt,
  type ShareFillAuditPlan,
  type ShareFillPlacerKind,
} from "@/lib/corporations/commands/shareTrading/shareFillAudit";
import {
  executeShareFillMoneyFlow,
  personalBalanceField,
  recoverShareFillMoneyByFillKey,
  SHARE_FILL_FUND_SELL_TX_DOMAIN,
  SHARE_FILL_MONEY_INSUFFICIENT_FUNDS,
  SHARE_FILL_MONEY_LIQUIDITY_SHARES,
  SHARE_FILL_MONEY_SELLER_SHARES,
  type ShareFillMoneyPlan,
} from "@/lib/corporations/commands/shareTrading/shareFillMoney";
import { keyedInsertId } from "@/lib/db/nonAtomicMoneyFlow";
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
    // Repair a stranded legacy claim and recover the stamped prior attempt
    // (money first, then audit) before validating: a stuck `filled` order
    // is fillable again here, and a prior attempt crashed mid-money
    // converges its balances before this fill reads them.
    const prepared = await prepareShareFillClaim(db, loadedOrder);
    if (prepared.order.lastShareFillKey) {
      await recoverShareFillMoneyByFillKey(db, prepared.order.lastShareFillKey);
    }
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

    // Both seller-leg sites (corporation-buyer below, character-buyer further
    // down) move fund proceeds through the same keyed money plan: the
    // cashAnchor credit is a compare-and-set money leg, and the fund-subject
    // ledger row is emitted once post-commit with the attempt's deterministic
    // id (convergent on retry, never part of the money prefix).

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
        // All money moves through the keyed share-fill money flow (issue
        // #1672): corp debit, seller/inventory debit, buyer credit, and
        // seller proceeds run as compare-and-set steps under the attempt
        // key, so a crash between any two converges on retry instead of
        // leaving the filler debited with the seller unpaid.
        const moneyPlan: ShareFillMoneyPlan = {
          version: 1,
          fillKey,
          orderIdHex: order._id.toHexString(),
          corpIdHex: corporation._id.toHexString(),
          direction: "sell-fill",
          shares,
          turn: currentTurn,
          nowIso: now.toISOString(),
          fillerDebit: {
            collection: "corporations",
            idHex: buyingCorp._id.toHexString(),
            field: "liquidCapital",
            amount: costInBuyerCapital,
          },
          fillerCredit: null,
          sellerDebit:
            !order.placerFundId &&
            !order.placerCorporationId &&
            order.sharesDebitedAtCreation !== true
              ? {
                  field: "characterId",
                  idHex: orderCharacterId!.toHexString(),
                  pricePerShare: sellerCharacterAvgCost ?? order.pricePerShare,
                }
              : null,
          buyerCredit: {
            field: "corporationId",
            idHex: buyingCorp._id.toHexString(),
            pricePerShare: order.pricePerShare,
          },
          // Sell-fill buyers are the filler (a corporation or character),
          // never a fund, so there is no fund-holdings credit leg here. The
          // field stays required on the plan; null is its correct value for
          // this direction (the step builder only reads it on buy-fills).
          buyerHoldingsCredit: null,
          fundInventoryDebit: order.placerFundId
            ? {
                fundIdHex: order.placerFundId.toHexString(),
                pricePerShareAnchor: fundFillPriceAnchor,
              }
            : null,
          sellerProceeds: order.placerFundId
            ? {
                collection: "indexFunds",
                idHex: order.placerFundId.toHexString(),
                field: "cashAnchor",
                amount: total,
              }
            : order.placerCorporationId
              ? {
                  collection: "corporations",
                  idHex: order.placerCorporationId.toHexString(),
                  field: "liquidCapital",
                  amount: pinnedSellerAmount,
                }
              : {
                  collection: "characters",
                  idHex: orderCharacterId!.toHexString(),
                  field: personalBalanceField(
                    pinnedSellerCurrency ?? fillerHomeCurrency,
                    forexEnabled
                  ),
                  amount: pinnedSellerAmount,
                },
        };
        let moneyOutcome;
        try {
          moneyOutcome = await executeShareFillMoneyFlow(db, moneyPlan);
        } catch (err) {
          await restoreClaimedOrder();
          const code = err instanceof Error ? err.message.split(":")[0] : "";
          if (code === SHARE_FILL_MONEY_INSUFFICIENT_FUNDS) {
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
          if (code === SHARE_FILL_MONEY_SELLER_SHARES) {
            await settleShareFillAttempt(db, fillKey, "failed", "share-fill:claim-restored");
            return NextResponse.json(
              { error: "Seller no longer has enough shares to settle this order" },
              { status: 409 }
            );
          }
          if (code === SHARE_FILL_MONEY_LIQUIDITY_SHARES) {
            await settleShareFillAttempt(db, fillKey, "failed", "share-fill:claim-restored");
            return NextResponse.json(
              { error: "Liquidity provider no longer has enough shares" },
              { status: 409 }
            );
          }
          await settleShareFillAttempt(
            db,
            fillKey,
            "failed",
            err instanceof Error ? err.message : "share-fill:settlement-failed"
          );
          throw err;
        }
        fillerBalanceAfter = moneyOutcome.fillerBalanceAfter;
      } else {
        // Filler is buying as a character — debit shares from seller, credit to filler.
        // Same keyed money flow as the corp-filler path: wallet debit,
        // seller/inventory debit, buyer credit, and seller proceeds converge
        // on retry instead of stranding the filler debit.
        const charMoneyPlan: ShareFillMoneyPlan = {
          version: 1,
          fillKey,
          orderIdHex: order._id.toHexString(),
          corpIdHex: corporation._id.toHexString(),
          direction: "sell-fill",
          shares,
          turn: currentTurn,
          nowIso: now.toISOString(),
          fillerDebit: {
            collection: fillerCollectionName,
            idHex: fillerId.toHexString(),
            field: personalBalanceField(fillerHomeCurrency, forexEnabled),
            amount: totalInFillerHome,
          },
          fillerCredit: null,
          sellerDebit:
            !order.placerFundId &&
            !order.placerCorporationId &&
            order.sharesDebitedAtCreation !== true
              ? {
                  field: "characterId",
                  idHex: orderCharacterId!.toHexString(),
                  pricePerShare: sellerCharacterAvgCost ?? order.pricePerShare,
                }
              : null,
          buyerCredit: {
            field: isImperialFiller ? "imperialCharacterId" : "characterId",
            idHex: fillerId.toHexString(),
            pricePerShare: order.pricePerShare,
          },
          // Same as the corporation-filler site above: sell-fill buyers are
          // never a fund, so the fund-holdings credit leg is null here.
          buyerHoldingsCredit: null,
          fundInventoryDebit: order.placerFundId
            ? {
                fundIdHex: order.placerFundId.toHexString(),
                pricePerShareAnchor: fundFillPriceAnchor,
              }
            : null,
          sellerProceeds: order.placerFundId
            ? {
                collection: "indexFunds",
                idHex: order.placerFundId.toHexString(),
                field: "cashAnchor",
                amount: total,
              }
            : order.placerCorporationId
              ? {
                  collection: "corporations",
                  idHex: order.placerCorporationId.toHexString(),
                  field: "liquidCapital",
                  amount: pinnedSellerAmount,
                }
              : {
                  collection: "characters",
                  idHex: orderCharacterId!.toHexString(),
                  field: personalBalanceField(
                    pinnedSellerCurrency ?? fillerHomeCurrency,
                    forexEnabled
                  ),
                  amount: pinnedSellerAmount,
                },
        };
        let charMoneyOutcome;
        try {
          charMoneyOutcome = await executeShareFillMoneyFlow(db, charMoneyPlan);
        } catch (err) {
          await restoreClaimedOrder();
          const code = err instanceof Error ? err.message.split(":")[0] : "";
          if (code === SHARE_FILL_MONEY_INSUFFICIENT_FUNDS) {
            await settleShareFillAttempt(db, fillKey, "failed", "share-fill:claim-restored");
            return NextResponse.json({ error: "Insufficient funds" }, { status: 400 });
          }
          if (code === SHARE_FILL_MONEY_SELLER_SHARES) {
            await settleShareFillAttempt(db, fillKey, "failed", "share-fill:claim-restored");
            return NextResponse.json(
              { error: "Seller no longer has enough shares to settle this order" },
              { status: 409 }
            );
          }
          if (code === SHARE_FILL_MONEY_LIQUIDITY_SHARES) {
            await settleShareFillAttempt(db, fillKey, "failed", "share-fill:claim-restored");
            return NextResponse.json(
              { error: "Liquidity provider no longer has enough shares" },
              { status: 409 }
            );
          }
          await settleShareFillAttempt(
            db,
            fillKey,
            "failed",
            err instanceof Error ? err.message : "share-fill:settlement-failed"
          );
          throw err;
        }
        fillerBalanceAfter = charMoneyOutcome.fillerBalanceAfter;
      }
      // Money committed (the flow bridged the audit receipt). Emit the
      // fund-proceeds ledger row convergently when the placer is a fund, then
      // write the audit convergently under the attempt key: a crash from here
      // on is repaired by recovery, and an audit failure leaves the receipt
      // in_progress for that recovery instead of rolling back moved money
      // over a missing row.
      if (order.placerFundId) {
        await emitSellerFundProceedsRow({
          db,
          fundId: order.placerFundId,
          fundName: sellerFund?.name ?? "Index fund",
          fundAnchorCurrency: sellerFund?.anchorCurrencyCode ?? "USD",
          total,
          buyer: fillAsCorporation
            ? {
                type: "corporation",
                id: buyingCorpForSellFill!._id,
                name: buyingCorpForSellFill!.name,
              }
            : { type: "character", id: fillerId, name: fillerName },
          corporationId: corporation._id,
          orderId: order._id,
          shares,
          pricePerShare: order.pricePerShare,
          currentTurn,
          now,
          dedupeId: keyedInsertId(fillKey, SHARE_FILL_FUND_SELL_TX_DOMAIN),
        });
      }
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
