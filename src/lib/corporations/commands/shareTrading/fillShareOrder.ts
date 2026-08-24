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
import type { Character, Corporation, ShareOrder, User } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import {
  creditShares,
  creditSharesToImperial,
  creditSharesToCorp,
  debitShares,
  debitSharesFromCorp,
  debitSharesFromImperial,
} from "@/lib/corporations/shareholderOps";
import {
  reconcileTotalSharesAfterFill,
  resolveCharName,
  resolveCorpName,
  settleBuyOrderFill,
} from "@/lib/corporations/commands/shareTrading/fillShareOrderSettlement";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
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
import { emitTx } from "@/lib/financialTxLog/emit";
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
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import type { ShareTradeParty } from "@/lib/db/types/shareTradeHistory";
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

    const order = await db
      .collection<ShareOrder>("shareOrders")
      .findOne({ _id: new ObjectId(orderId) });

    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
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
    }

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
    const newSharesRemaining = order.sharesRemaining - shares;
    const orderFilled = newSharesRemaining === 0;
    const forexEnabled = await isForexEnabled();
    const fillerHomeCurrency = getHomeCurrency({ countryId: fillerCountryId });
    const currentTurn = await getCurrentTurn(db);

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
      if (!order.placerCorporationId && orderCharacterId!.equals(buyingCorp.ceoId)) {
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

    const claimedOrder = await db.collection<ShareOrder>("shareOrders").findOneAndUpdate(
      {
        _id: order._id,
        status: "open",
        sharesRemaining: { $gte: shares },
      },
      [
        {
          $set: {
            sharesRemaining: { $subtract: ["$sharesRemaining", shares] },
            escrowAmount: {
              $cond: [
                { $eq: ["$type", "buy"] },
                { $multiply: [{ $subtract: ["$sharesRemaining", shares] }, "$pricePerShare"] },
                "$escrowAmount",
              ],
            },
            // For fund buy orders: decrement escrowAnchor proportionally so NAV
            // doesn't over-count anchor-denominated escrow after a partial peer-fill.
            escrowAnchor: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$type", "buy"] },
                    { $gt: ["$sharesRemaining", 0] },
                    { $gt: [{ $ifNull: ["$escrowAnchor", 0] }, 0] },
                  ],
                },
                {
                  $multiply: [
                    "$escrowAnchor",
                    { $divide: [{ $subtract: ["$sharesRemaining", shares] }, "$sharesRemaining"] },
                  ],
                },
                "$escrowAnchor",
              ],
            },
            status: "filled",
            updatedAt: now,
          },
        },
      ],
      { returnDocument: "after" }
    );

    if (!claimedOrder) {
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
      await db
        .collection<ShareOrder>("shareOrders")
        .updateOne({ _id: order._id }, { $set: restoreFields });
    };

    const sellerCharacterAvgCost = orderCharacterId
      ? corporation.shareholders?.find((sh) => sh.characterId?.equals(orderCharacterId))
          ?.avgCostPerShare
      : undefined;

    if (order.type === "sell") {
      if (fillAsCorporation) {
        // Filler is a corporation (CEO's company) — pay from liquidCapital, credit shares to that corp.
        const buyingCorp = buyingCorpForSellFill;
        if (!buyingCorp) throw new Error("Validated buying corporation missing");

        const buyingCurrency = (resolveCorpLiquidCurrencyCode(buyingCorp) ?? "USD") as CurrencyCode;
        const targetCurrency = (resolveCorpLiquidCurrencyCode(corporation) ??
          "USD") as CurrencyCode;
        const buyerFxRate = await getCorpFxRate(db, buyingCorp);
        const fxRates = await loadFxRatesRecord(db);
        const corpPurchaseEstimate = estimateCorpWalletSpend({
          requiredAmount: totalLocal,
          availableBalance: buyingCorp.liquidCapital ?? 0,
          fromCurrency: buyingCurrency,
          toCurrency: targetCurrency,
          rates: fxRates,
        });
        if (!corpPurchaseEstimate) {
          await restoreClaimedOrder();
          return NextResponse.json(
            { error: "Exchange rate unavailable, try again shortly" },
            { status: 503 }
          );
        }
        const costInBuyerCapital =
          buyingCurrency !== targetCurrency
            ? corpPurchaseEstimate.spendAmount
            : anchorToCorpLiquidCapital(total, buyingCorp, buyerFxRate);
        if (buyingCurrency !== targetCurrency) {
          fillerBuyConversionSpread = {
            fee: corpPurchaseEstimate.spreadFee,
            from: buyingCurrency,
            to: targetCurrency,
          };
        }
        let sellerSharesDebited = false;
        let buyerSharesCredited = false;
        let sellerCapitalCredited = false;
        let sellerHomeCredited = false;
        let totalInSellerCapital = 0;
        let totalInSellerHome = 0;
        let sellerCurrency: CurrencyCode | null = null;

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
          // Skip when sharesDebitedAtCreation: placement already took the shares.
          // Legacy character sells without that flag still debit here.
          if (!order.placerCorporationId && order.sharesDebitedAtCreation !== true) {
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

          if (order.placerCorporationId) {
            const sellerCorp = await db
              .collection<Corporation>("corporations")
              .findOne({ _id: order.placerCorporationId });
            const sellerFxRate = await getCorpFxRate(db, sellerCorp ?? {});
            totalInSellerCapital = anchorToCorpLiquidCapital(total, sellerCorp ?? {}, sellerFxRate);
            await db
              .collection<Corporation>("corporations")
              .updateOne(
                { _id: order.placerCorporationId },
                { $inc: { liquidCapital: totalInSellerCapital }, $set: { updatedAt: now } }
              );
            sellerCapitalCredited = true;
            await emitTx(db, {
              type: "stock_trade_sell",
              turn: currentTurn,
              createdAt: now,
              subjectType: "corporation",
              subjectId: order.placerCorporationId,
              subjectName: sellerCorp?.name ?? "Unknown corporation",
              amount: totalInSellerCapital,
              currencyCode: resolveCorpLiquidCurrencyCode(sellerCorp ?? {}) ?? "USD",
              counterpartyType: "corporation",
              counterpartyId: buyingCorp._id,
              counterpartyName: buyingCorp.name,
              meta: {
                corporationId: corporation._id.toString(),
                orderId: order._id.toString(),
                shares,
                pricePerShare: order.pricePerShare,
                source: "order_fill_sell_order",
              },
            });
          } else {
            const seller = await db
              .collection<Character>("characters")
              .findOne({ _id: orderCharacterId }, { projection: { countryId: 1, name: 1 } });
            sellerCurrency = seller ? getHomeCurrency(seller as Character) : fillerHomeCurrency;
            let sellerFxRate = 1.0;
            if (forexEnabled) {
              const sellerFxResult = await loadCharacterFxRate(db, sellerCurrency);
              if (!sellerFxResult.ok) {
                throw new Error("Exchange rate unavailable for seller");
              }
              sellerFxRate = sellerFxResult.rate;
            }
            totalInSellerHome = total * sellerFxRate;
            await db.collection<Character>("characters").updateOne(
              { _id: orderCharacterId },
              {
                $inc: buildPersonalBalanceInc(totalInSellerHome, sellerCurrency, forexEnabled),
                $set: { updatedAt: now },
              }
            );
            sellerHomeCredited = true;
            await emitTx(db, {
              type: "stock_trade_sell",
              turn: currentTurn,
              createdAt: now,
              subjectType: "character",
              subjectId: orderCharacterId,
              subjectName: seller?.name ?? "Unknown character",
              amount: totalInSellerHome,
              currencyCode: sellerCurrency,
              counterpartyType: "corporation",
              counterpartyId: buyingCorp._id,
              counterpartyName: buyingCorp.name,
              meta: {
                corporationId: corporation._id.toString(),
                orderId: order._id.toString(),
                shares,
                pricePerShare: order.pricePerShare,
                source: "order_fill_sell_order",
              },
            });
          }
          await emitTx(db, {
            type: "stock_trade_buy",
            turn: currentTurn,
            createdAt: now,
            subjectType: "corporation",
            subjectId: buyingCorp._id,
            subjectName: buyingCorp.name,
            amount: -costInBuyerCapital,
            balanceAfter: corpDebit.newBalance,
            currencyCode: resolveCorpLiquidCurrencyCode(buyingCorp) ?? "USD",
            counterpartyType: order.placerCorporationId ? "corporation" : "character",
            counterpartyId: order.placerCorporationId ?? orderCharacterId!,
            counterpartyName: order.placerCorporationId
              ? await resolveCorpName(db, order.placerCorporationId)
              : await resolveCharName(db, orderCharacterId!, false),
            meta: {
              corporationId: corporation._id.toString(),
              orderId: order._id.toString(),
              shares,
              pricePerShare: order.pricePerShare,
              source: "order_fill_sell_order",
            },
          });
        } catch (err) {
          if (sellerHomeCredited && sellerCurrency) {
            await db.collection<Character>("characters").updateOne(
              { _id: orderCharacterId! },
              {
                $inc: buildPersonalBalanceInc(-totalInSellerHome, sellerCurrency, forexEnabled),
                $set: { updatedAt: new Date() },
              }
            );
          }
          if (sellerCapitalCredited && order.placerCorporationId) {
            await db
              .collection<Corporation>("corporations")
              .updateOne(
                { _id: order.placerCorporationId },
                { $inc: { liquidCapital: -totalInSellerCapital }, $set: { updatedAt: new Date() } }
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
        let totalInSellerCapital = 0;
        let totalInSellerHome = 0;
        let sellerCurrency: CurrencyCode | null = null;
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
          return NextResponse.json({ error: "Insufficient funds" }, { status: 400 });
        }

        try {
          // Skip when sharesDebitedAtCreation: placement already took the shares.
          // Legacy character sells without that flag still debit here.
          if (!order.placerCorporationId && order.sharesDebitedAtCreation !== true) {
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

          if (order.placerCorporationId) {
            const sellerCorp = await db
              .collection<Corporation>("corporations")
              .findOne({ _id: order.placerCorporationId });
            const sellerFxRate = await getCorpFxRate(db, sellerCorp ?? {});
            totalInSellerCapital = anchorToCorpLiquidCapital(total, sellerCorp ?? {}, sellerFxRate);
            await db
              .collection<Corporation>("corporations")
              .updateOne(
                { _id: order.placerCorporationId },
                { $inc: { liquidCapital: totalInSellerCapital }, $set: { updatedAt: now } }
              );
            sellerCapitalCredited = true;
            await emitTx(db, {
              type: "stock_trade_sell",
              turn: currentTurn,
              createdAt: now,
              subjectType: "corporation",
              subjectId: order.placerCorporationId,
              subjectName: sellerCorp?.name ?? "Unknown corporation",
              amount: totalInSellerCapital,
              currencyCode: resolveCorpLiquidCurrencyCode(sellerCorp ?? {}) ?? "USD",
              counterpartyType: "character",
              counterpartyId: fillerId,
              counterpartyName: fillerName,
              meta: {
                corporationId: corporation._id.toString(),
                orderId: order._id.toString(),
                shares,
                pricePerShare: order.pricePerShare,
                source: "order_fill_sell_order",
              },
            });
          } else {
            // Seller is a character — credit in their home currency
            const seller = await db
              .collection<Character>("characters")
              .findOne({ _id: orderCharacterId }, { projection: { countryId: 1, name: 1 } });
            sellerCurrency = seller ? getHomeCurrency(seller as Character) : fillerHomeCurrency;
            let sellerFxRate = 1.0;
            if (forexEnabled) {
              const sellerFxResult = await loadCharacterFxRate(db, sellerCurrency);
              if (!sellerFxResult.ok) {
                throw new Error("Exchange rate unavailable for seller");
              }
              sellerFxRate = sellerFxResult.rate;
            }
            totalInSellerHome = total * sellerFxRate;
            await db.collection<Character>("characters").updateOne(
              { _id: orderCharacterId },
              {
                $inc: buildPersonalBalanceInc(totalInSellerHome, sellerCurrency, forexEnabled),
                $set: { updatedAt: now },
              }
            );
            sellerHomeCredited = true;
            await emitTx(db, {
              type: "stock_trade_sell",
              turn: currentTurn,
              createdAt: now,
              subjectType: "character",
              subjectId: orderCharacterId,
              subjectName: seller?.name ?? "Unknown character",
              amount: totalInSellerHome,
              currencyCode: sellerCurrency,
              counterpartyType: "character",
              counterpartyId: fillerId,
              counterpartyName: fillerName,
              meta: {
                corporationId: corporation._id.toString(),
                orderId: order._id.toString(),
                shares,
                pricePerShare: order.pricePerShare,
                source: "order_fill_sell_order",
              },
            });
          }
          await emitTx(db, {
            type: "stock_trade_buy",
            turn: currentTurn,
            createdAt: now,
            subjectType: "character",
            subjectId: fillerId,
            subjectName: fillerName,
            amount: -totalInFillerHome,
            balanceAfter: debitResult.newBalance,
            currencyCode: fillerHomeCurrency,
            counterpartyType: order.placerCorporationId ? "corporation" : "character",
            counterpartyId: order.placerCorporationId ?? orderCharacterId!,
            counterpartyName: order.placerCorporationId
              ? await resolveCorpName(db, order.placerCorporationId)
              : await resolveCharName(db, orderCharacterId!, false),
            meta: {
              corporationId: corporation._id.toString(),
              orderId: order._id.toString(),
              shares,
              pricePerShare: order.pricePerShare,
              source: "order_fill_sell_order",
              imperial: isImperialFiller || undefined,
            },
          });
        } catch (err) {
          if (sellerHomeCredited && sellerCurrency) {
            await db.collection<Character>("characters").updateOne(
              { _id: orderCharacterId! },
              {
                $inc: buildPersonalBalanceInc(-totalInSellerHome, sellerCurrency, forexEnabled),
                $set: { updatedAt: new Date() },
              }
            );
          }
          if (sellerCapitalCredited && order.placerCorporationId) {
            await db
              .collection<Corporation>("corporations")
              .updateOne(
                { _id: order.placerCorporationId },
                { $inc: { liquidCapital: -totalInSellerCapital }, $set: { updatedAt: new Date() } }
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
      });
      if (buyOrderErrorResponse) return buyOrderErrorResponse;
    }

    if (!orderFilled) {
      await db
        .collection<ShareOrder>("shareOrders")
        .updateOne({ _id: order._id }, { $set: { status: "open", updatedAt: now } });
    }

    // Emit peer-fill history. Resolve party display names on demand — kept
    // inline rather than threaded through the branches above so the diff
    // stays localized. Names are denormalized; any rename updates only
    // subsequent history rows.
    let fromParty: ShareTradeParty | null = null;
    let toParty: ShareTradeParty | null = null;
    if (order.type === "sell") {
      // Filler is the buyer.
      if (fillAsCorporation) {
        const buyerCorpDoc = await db
          .collection<Corporation>("corporations")
          .findOne({ ceoId: fillerId }, { projection: { _id: 1, name: 1 } });
        if (buyerCorpDoc) {
          toParty = { corporationId: buyerCorpDoc._id, name: buyerCorpDoc.name };
        }
      } else {
        toParty = {
          ...(isImperialFiller ? { imperialCharacterId: fillerId } : { characterId: fillerId }),
          name: await resolveCharName(db, fillerId, isImperialFiller),
        };
      }
      if (order.placerCorporationId) {
        fromParty = {
          corporationId: order.placerCorporationId,
          name: await resolveCorpName(db, order.placerCorporationId),
        };
      } else {
        fromParty = {
          characterId: orderCharacterId!,
          name: await resolveCharName(db, orderCharacterId!, false),
        };
      }
    } else {
      // Buy order — filler is the seller, placer is the buyer.
      fromParty = {
        ...(isImperialFiller ? { imperialCharacterId: fillerId } : { characterId: fillerId }),
        name: await resolveCharName(db, fillerId, isImperialFiller),
      };
      if (order.placerFundId) {
        toParty = { name: "Index fund" };
      } else if (order.placerCorporationId) {
        toParty = {
          corporationId: order.placerCorporationId,
          name: await resolveCorpName(db, order.placerCorporationId),
        };
      } else {
        toParty = {
          characterId: orderCharacterId!,
          name: await resolveCharName(db, orderCharacterId!, false),
        };
      }
    }
    void recordShareTrade(db, {
      corporationId: corporation._id,
      kind: "peer_fill",
      turn: currentTurn,
      shares,
      pricePerShareAnchor: total / shares,
      from: fromParty,
      to: toParty,
      corpCurrencyCode: corporation.liquidCurrencyCode,
    });

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
