import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { placeOrderSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { assertCeoTradeNotBlocked } from "@/lib/corporations/commands/privatization/openVoteGuard";
import {
  corpPurchaseWouldCycle,
  OWNERSHIP_CYCLE_ERROR,
} from "@/lib/corporations/subsidiaries/cycleGuard";
import type { Character, Corporation, ShareOrder } from "@/lib/db/types";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import {
  creditShares,
  debitShares,
  creditSharesToCorp,
  debitSharesFromCorp,
} from "@/lib/corporations/shareholderOps";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  buildPersonalBalanceInc,
  getHomeCurrency,
  loadCharacterFxRate,
} from "@/lib/currency/characterFunds";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  estimateCorpWalletSpend,
  getCorpFxRate,
  loadFxRatesRecord,
  resolveCorpLiquidCurrencyCode,
  shareTradeAnchorValue,
} from "@/lib/currency/corporationCapital";
import { distributeConversionSpread } from "@/lib/currency/marketMaker";
import { notifyHostileTakeoverThresholdIfEligible } from "@/lib/corporations/hostileTakeoverNotifications";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { assertCeoAcquisitionWithinCap } from "@/lib/corporations/ceoShareAcquisitionCap";
import {
  atomicallyDebitCharacterCash,
  refundCharacterCash,
  atomicallyDebitCorpLiquidCapital,
  refundCorpLiquidCapital,
} from "@/lib/financialTxLog/atomicCashGuard";
import {
  applyFloatBuyCredit,
  settleFloatSellDebit,
  reverseFloatSellDebit,
  onFloatSellCommitted,
  type EscrowDebitSplit,
} from "@/lib/corporations/shareEscrowSettlement";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { emitTx } from "@/lib/financialTxLog/emit";
import {
  isOrderFlowPriceEligible,
  isWithinShareExecutionBand,
} from "@/lib/corporations/marketExecution";
import { equityPoolDepthMessage, loadEquityQuote } from "@/lib/equities/marketPool";
import { recordAudit } from "@/lib/audit/recordAudit";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/shares/orders
 * Place a limit buy or sell order.
 *
 * Buy order: money escrowed immediately from corp `liquidCapital` or character
 * `currencyBalances.personal`. If current price <= limit price, fills immediately
 * from public float. Otherwise stays open until price drops.
 *
 * Sell order: shares debited from holdings immediately (`sharesDebitedAtCreation`).
 *   If current price >= limit price, fills immediately (money credited).
 *   Otherwise stays open until price rises.
 */
export async function placeShareOrder(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, placeOrderSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { type, shares, pricePerShare, placeAsCorporation } = parsed.data;
    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;
    const turnGuard = await rejectDuringTurn(db);
    if (turnGuard) return turnGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;
    const marketQuote = await loadEquityQuote(db, corporation);
    const executionPrice = type === "buy" ? marketQuote.askPriceLocal : marketQuote.bidPriceLocal;
    const orderFlowEligible = isOrderFlowPriceEligible(
      corporation.publicFloat,
      corporation.totalShares
    );

    // Limit prices must sit inside the fundamental-anchored sanity band.
    // Wildly off-fundamental limit orders were used as manipulation rails
    // (2026-08-20 incident: limit fills ~10x fundamental inflated order-flow
    // notionals and moved real money at fabricated prices). Honest orders
    // near the market price are unaffected; the band only exists when the
    // corp has a positive fundamentalSharePrice to anchor on.
    if (!isWithinShareExecutionBand(corporation, pricePerShare)) {
      return NextResponse.json(
        {
          error: `Limit price is too far from ${corporation.name}'s fundamental share price. Place an order closer to the current valuation.`,
        },
        { status: 400 }
      );
    }

    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }
    const tradeLock = await assertCeoTradeNotBlocked(db, corporation, character._id);
    if (tradeLock.blocked) {
      return NextResponse.json({ error: tradeLock.error }, { status: tradeLock.status });
    }
    const now = new Date();
    const forexEnabled = await isForexEnabled();
    const homeCurrency = getHomeCurrency(character);

    // sharePrice and user-supplied pricePerShare are both denominated in the
    // target corp's liquidCurrencyCode (v0.2.6). Normalize to ₳ here; every
    // cost/proceeds/escrow calculation below reads through this rate.
    const targetFxRate = await getCorpFxRate(db, corporation);
    const currentTurn = await getCurrentTurn(db);

    // CEO self-acquisition cap: a personal buy order by the corp's own CEO counts
    // against the 10%/120-turn window (reserved at placement; open buy orders are
    // tallied by the guard). Corp-placed orders can't trade own shares (blocked below).
    if (!placeAsCorporation && type === "buy") {
      const ceoCap = await assertCeoAcquisitionWithinCap(
        db,
        corporation,
        character._id,
        "characterId",
        shares,
        currentTurn
      );
      if (ceoCap) return NextResponse.json({ error: ceoCap.error }, { status: ceoCap.status });
    }

    // Treasury-backed market maker: an immediate-fill sell into the float is
    // bought back from the ISSUER's own liquidCapital (its local currency),
    // capped at what the treasury holds. Mirrors the market-order sell route so
    // a limit order can't bypass the cap. (Pending orders that don't fill now
    // are filled later peer-to-peer or by the turn processor.)
    const issuerBuyback = shares * executionPrice;
    const issuerCurrency = resolveCorpLiquidCurrencyCode(corporation) ?? "USD";
    // Hoisted so the outer-scope rollback paths can reverse the exact escrow/
    // treasury split recorded when the issuer buyback was settled.
    let issuerBuybackSplit: EscrowDebitSplit | undefined;
    async function gateIssuerBuyback(): Promise<NextResponse | null> {
      if (marketQuote.active && shares > marketQuote.bidDepthShares) {
        return NextResponse.json(
          {
            error: equityPoolDepthMessage(marketQuote.bidDepthShares, marketQuote.currency),
            marketDepthShares: marketQuote.bidDepthShares,
          },
          { status: 400 }
        );
      }
      const settle = await settleFloatSellDebit(db, corporation, issuerBuyback);
      issuerBuybackSplit = settle.split;
      if (!settle.ok) {
        const sym = CURRENCY_SYMBOLS[issuerCurrency] ?? "$";
        return NextResponse.json(
          {
            error: marketQuote.active
              ? equityPoolDepthMessage(marketQuote.bidDepthShares, marketQuote.currency)
              : `${corporation.name}'s treasury can't cover this sale (needs ${sym}${issuerBuyback.toLocaleString(undefined, { maximumFractionDigits: 0 })}). List the shares for sale to a real buyer instead.`,
            ...(marketQuote.active ? { marketDepthShares: marketQuote.bidDepthShares } : {}),
          },
          { status: 400 }
        );
      }
      return null;
    }

    if (placeAsCorporation) {
      const placerCorp = await db
        .collection<Corporation>("corporations")
        .findOne({ ceoId: character._id, ceoVacant: { $ne: true } });
      if (!placerCorp) {
        return NextResponse.json(
          { error: "You must be an active CEO to place orders on behalf of a corporation" },
          { status: 403 }
        );
      }

      if (placerCorp._id.equals(corporation._id)) {
        return NextResponse.json(
          { error: "A corporation cannot trade its own shares" },
          { status: 400 }
        );
      }

      if (placerCorp.countryOwnerId) {
        return NextResponse.json(
          { error: "National corporations cannot hold equity positions" },
          { status: 400 }
        );
      }

      if (type === "buy" && (await corpPurchaseWouldCycle(db, placerCorp._id, corporation._id))) {
        return NextResponse.json({ error: OWNERSHIP_CYCLE_ERROR }, { status: 400 });
      }

      const placerFxRate = await getCorpFxRate(db, placerCorp);
      const placerCurrency = (resolveCorpLiquidCurrencyCode(placerCorp) ?? "USD") as CurrencyCode;
      const targetCurrency = (resolveCorpLiquidCurrencyCode(corporation) ?? "USD") as CurrencyCode;
      const fxRates = await loadFxRatesRecord(db);

      if (type === "buy") {
        const fillsNow = executionPrice <= pricePerShare;
        const publicFloat = corporation.publicFloat ?? 0;

        if (fillsNow && publicFloat >= shares) {
          const cost = shareTradeAnchorValue(
            shares,
            { ...corporation, sharePrice: executionPrice },
            targetFxRate
          );
          const corpPurchaseEstimate = estimateCorpWalletSpend({
            requiredAmount: shares * executionPrice,
            availableBalance: placerCorp.liquidCapital ?? 0,
            fromCurrency: placerCurrency,
            toCurrency: targetCurrency,
            rates: fxRates,
          });
          if (!corpPurchaseEstimate) {
            return NextResponse.json(
              { error: "Exchange rate unavailable, try again shortly" },
              { status: 503 }
            );
          }
          const costInPlacerCapital =
            placerCurrency !== targetCurrency
              ? corpPurchaseEstimate.spendAmount
              : anchorToCorpLiquidCapital(cost, placerCorp, placerFxRate);
          // Atomic balance-gated debit on the placer corp's liquidCapital.
          // Same race-fix as bond-buy/share-buy: read-then-write check on
          // placerCapitalAnchor would let concurrent buys both pass the
          // staleness check and silently overspend or split-debit.
          const corpDebit = await atomicallyDebitCorpLiquidCapital(
            db,
            placerCorp._id,
            costInPlacerCapital
          );
          if (!corpDebit.ok) {
            return NextResponse.json({ error: "Insufficient corporation funds" }, { status: 400 });
          }
          let sharesCredited = false;
          try {
            const credited = await creditSharesToCorp(
              db,
              corporation._id,
              placerCorp._id,
              shares,
              executionPrice,
              {
                $inc: {
                  publicFloat: -shares,
                  ...(orderFlowEligible
                    ? { orderFlowWindowBuyValue: shares * executionPrice }
                    : {}),
                },
                $set: { updatedAt: now },
              },
              { guardFilter: { publicFloat: { $gte: shares } } }
            );
            if (!credited) {
              await refundCorpLiquidCapital(db, placerCorp._id, costInPlacerCapital);
              return NextResponse.json(
                { error: "Not enough shares remain in public float" },
                { status: 409 }
              );
            }
            sharesCredited = true;
            void recordShareTrade(db, {
              corporationId: corporation._id,
              kind: "limit_fill",
              turn: currentTurn,
              shares,
              pricePerShareAnchor: cost / shares,
              from: null,
              to: { corporationId: placerCorp._id, name: placerCorp.name },
              corpCurrencyCode: corporation.liquidCurrencyCode,
            });
            void notifyHostileTakeoverThresholdIfEligible(db, corporation._id);
            await emitTx(db, {
              type: "stock_trade_buy",
              turn: currentTurn,
              createdAt: now,
              subjectType: "corporation",
              subjectId: placerCorp._id,
              subjectName: placerCorp.name,
              amount: -costInPlacerCapital,
              balanceAfter: corpDebit.newBalance,
              currencyCode: resolveCorpLiquidCurrencyCode(placerCorp) ?? "USD",
              counterpartyType: "corporation",
              counterpartyId: corporation._id,
              counterpartyName: corporation.name,
              meta: {
                corporationId: corporation._id.toString(),
                shares,
                pricePerShare: executionPrice,
                source: "limit_order_immediate_fill",
              },
            });

            // Treasury-backed market maker: inject the buyer's payment into the
            // issuer treasury. Last in the try — a throw rolls back via the catch.
            await applyFloatBuyCredit(db, corporation, shares * executionPrice);

            // Cross-currency immediate fill realizes the spread now — route it to
            // the CB system. (Resting-order escrow defers its spread to fill time.)
            if (placerCurrency !== targetCurrency) {
              await distributeConversionSpread(
                db,
                corpPurchaseEstimate.spreadFee,
                placerCurrency,
                targetCurrency
              );
            }
          } catch (err) {
            if (sharesCredited) {
              await debitSharesFromCorp(
                db,
                corporation._id,
                placerCorp._id,
                shares,
                {
                  $inc: {
                    publicFloat: shares,
                    ...(orderFlowEligible
                      ? { orderFlowWindowBuyValue: -(shares * executionPrice) }
                      : {}),
                  },
                  $set: { updatedAt: new Date() },
                },
                { requireSufficient: true }
              );
            }
            await refundCorpLiquidCapital(db, placerCorp._id, costInPlacerCapital);
            throw err;
          }
          recordAudit({
            source: "api",
            action: "share.order",
            category: "market",
            subject: { type: "corporation", id: corporation._id, name: corporation.name },
            counterparty: { type: "corporation", id: placerCorp._id, name: placerCorp.name },
            amount: -costInPlacerCapital,
            currencyCode: placerCurrency,
            refs: { corporationId: corporation._id },
            delta: [
              { field: "orderType", before: null, after: "buy" },
              { field: "status", before: null, after: "filled" },
              { field: "shares", before: null, after: shares },
              { field: "pricePerShare", before: null, after: executionPrice },
            ],
            outcome: "ok",
          });
          return NextResponse.json({
            success: true,
            filled: true,
            sharesBought: shares,
            cost: Math.round(cost * 100) / 100,
            spreadPaid:
              placerCurrency !== targetCurrency
                ? Math.round(corpPurchaseEstimate.spreadFee * 100) / 100
                : 0,
            spreadCurrency: placerCurrency,
          });
        }

        // pricePerShare is specified by the user in the target corp's local
        // currency. Escrow is STORED in that same currency (Option B) so that
        // partial fills subtract cleanly and cancels/refunds are FX-stable
        // relative to the fill math. Wallet debit/credit converts via ₳.
        const escrowAmount = shares * pricePerShare;
        const escrowAnchor = corpLiquidCapitalToAnchor(escrowAmount, corporation, targetFxRate);
        const escrowEstimate = estimateCorpWalletSpend({
          requiredAmount: escrowAmount,
          availableBalance: placerCorp.liquidCapital ?? 0,
          fromCurrency: placerCurrency,
          toCurrency: targetCurrency,
          rates: fxRates,
        });
        if (!escrowEstimate) {
          return NextResponse.json(
            { error: "Exchange rate unavailable, try again shortly" },
            { status: 503 }
          );
        }
        const escrowInPlacerCapital =
          placerCurrency !== targetCurrency
            ? escrowEstimate.spendAmount
            : anchorToCorpLiquidCapital(escrowAnchor, placerCorp, placerFxRate);
        const escrowDebit = await atomicallyDebitCorpLiquidCapital(
          db,
          placerCorp._id,
          escrowInPlacerCapital
        );
        if (!escrowDebit.ok) {
          return NextResponse.json(
            { error: "Insufficient corporation funds for escrow" },
            { status: 400 }
          );
        }
        try {
          await db.collection<ShareOrder>("shareOrders").insertOne({
            _id: new ObjectId(),
            corporationId: corporation._id,
            characterId: character._id,
            placerCorporationId: placerCorp._id,
            type: "buy",
            shares,
            sharesRemaining: shares,
            pricePerShare,
            escrowAmount,
            status: "open",
            createdAt: now,
            updatedAt: now,
          });
          await emitTx(db, {
            type: "stock_order_escrow",
            turn: currentTurn,
            createdAt: now,
            subjectType: "corporation",
            subjectId: placerCorp._id,
            subjectName: placerCorp.name,
            amount: -escrowInPlacerCapital,
            balanceAfter: escrowDebit.newBalance,
            currencyCode: resolveCorpLiquidCurrencyCode(placerCorp) ?? "USD",
            counterpartyType: "system",
            counterpartyName: "Order book escrow",
            meta: {
              corporationId: corporation._id.toString(),
              shares,
              pricePerShare,
            },
          });
        } catch (err) {
          await refundCorpLiquidCapital(db, placerCorp._id, escrowInPlacerCapital);
          throw err;
        }
        // The placer's FX spread is consumed at placement — cancel refunds only
        // the share value (escrowAmount), not the spread markup — so route it to
        // the CB system now. Correct for both eventual fill and cancel, and
        // placed after the try so an insert failure (which fully refunds) can't
        // leave the spread distributed.
        if (placerCurrency !== targetCurrency) {
          await distributeConversionSpread(
            db,
            escrowEstimate.spreadFee,
            placerCurrency,
            targetCurrency
          );
        }
        recordAudit({
          source: "api",
          action: "share.order",
          category: "market",
          subject: { type: "corporation", id: corporation._id, name: corporation.name },
          counterparty: { type: "corporation", id: placerCorp._id, name: placerCorp.name },
          amount: -escrowInPlacerCapital,
          currencyCode: placerCurrency,
          refs: { corporationId: corporation._id },
          delta: [
            { field: "orderType", before: null, after: "buy" },
            { field: "status", before: null, after: "open" },
            { field: "shares", before: null, after: shares },
            { field: "pricePerShare", before: null, after: pricePerShare },
          ],
          outcome: "ok",
        });
        return NextResponse.json({
          success: true,
          filled: false,
          escrowAmount,
          spreadPaid:
            placerCurrency !== targetCurrency
              ? Math.round(escrowEstimate.spreadFee * 100) / 100
              : 0,
          spreadCurrency: placerCurrency,
        });
      } else {
        // Corp sell limit order
        const shareholderEntry = corporation.shareholders?.find(
          (sh) => sh.corporationId?.toString() === placerCorp._id.toString()
        );
        const ownedShares = shareholderEntry?.shares ?? 0;
        const openSellOrders = await db
          .collection<ShareOrder>("shareOrders")
          .find({
            corporationId: corporation._id,
            placerCorporationId: placerCorp._id,
            type: "sell",
            status: "open",
          })
          .toArray();
        const alreadyReserved = openSellOrders.reduce(
          (sum, o) => sum + (o.sharesDebitedAtCreation ? 0 : o.sharesRemaining),
          0
        );
        const available = ownedShares - alreadyReserved;
        if (available < shares) {
          return NextResponse.json(
            { error: `Only ${available.toLocaleString()} shares available` },
            { status: 400 }
          );
        }
        const fillsNow = executionPrice >= pricePerShare;
        if (fillsNow) {
          const proceeds =
            Math.round(
              shareTradeAnchorValue(
                shares,
                { ...corporation, sharePrice: executionPrice },
                targetFxRate
              ) * 100
            ) / 100;
          const proceedsInPlacerCapital = anchorToCorpLiquidCapital(
            proceeds,
            placerCorp,
            placerFxRate
          );
          const buybackGate = await gateIssuerBuyback();
          if (buybackGate) return buybackGate;
          const remainingAfterSale = await debitSharesFromCorp(
            db,
            corporation._id,
            placerCorp._id,
            shares,
            {
              $inc: {
                publicFloat: shares,
                ...(orderFlowEligible ? { orderFlowWindowSellValue: shares * executionPrice } : {}),
              },
              $set: { updatedAt: now },
            },
            { requireSufficient: true }
          );
          if (remainingAfterSale < 0) {
            await reverseFloatSellDebit(db, corporation, issuerBuyback, {
              split: issuerBuybackSplit,
            });
            return NextResponse.json(
              { error: "Shares were already sold or reserved by another action" },
              { status: 409 }
            );
          }
          let sellerCredited = false;
          try {
            const sellerCredit = await db
              .collection<Corporation>("corporations")
              .updateOne(
                { _id: placerCorp._id },
                { $inc: { liquidCapital: proceedsInPlacerCapital }, $set: { updatedAt: now } }
              );
            if (sellerCredit.matchedCount === 0) {
              throw new Error("Seller corporation not found");
            }
            sellerCredited = true;
            void recordShareTrade(db, {
              corporationId: corporation._id,
              kind: "limit_fill",
              turn: currentTurn,
              shares,
              pricePerShareAnchor: proceeds / shares,
              from: { corporationId: placerCorp._id, name: placerCorp.name },
              to: null,
              corpCurrencyCode: corporation.liquidCurrencyCode,
            });
            await emitTx(db, {
              type: "stock_trade_sell",
              turn: currentTurn,
              createdAt: now,
              subjectType: "corporation",
              subjectId: placerCorp._id,
              subjectName: placerCorp.name,
              amount: proceedsInPlacerCapital,
              currencyCode: resolveCorpLiquidCurrencyCode(placerCorp) ?? "USD",
              counterpartyType: "corporation",
              counterpartyId: corporation._id,
              counterpartyName: corporation.name,
              meta: {
                corporationId: corporation._id.toString(),
                shares,
                pricePerShare: executionPrice,
                source: "limit_order_immediate_fill",
              },
            });
          } catch (err) {
            if (sellerCredited) {
              await db.collection<Corporation>("corporations").updateOne(
                { _id: placerCorp._id },
                {
                  $inc: { liquidCapital: -proceedsInPlacerCapital },
                  $set: { updatedAt: new Date() },
                }
              );
            }
            await creditSharesToCorp(
              db,
              corporation._id,
              placerCorp._id,
              shares,
              shareholderEntry?.avgCostPerShare ?? executionPrice,
              {
                $inc: {
                  publicFloat: -shares,
                  ...(orderFlowEligible
                    ? { orderFlowWindowSellValue: -(shares * executionPrice) }
                    : {}),
                },
                $set: { updatedAt: new Date() },
              }
            );
            await reverseFloatSellDebit(db, corporation, issuerBuyback, {
              split: issuerBuybackSplit,
            });
            throw err;
          }
          // Sell-fill committed: back out realized issuance proceeds to match the
          // float shrinking (mirrors the buy-side credit). Best-effort/terminal.
          void onFloatSellCommitted(db, corporation, issuerBuyback);
          recordAudit({
            source: "api",
            action: "share.order",
            category: "market",
            subject: { type: "corporation", id: corporation._id, name: corporation.name },
            counterparty: { type: "corporation", id: placerCorp._id, name: placerCorp.name },
            amount: proceedsInPlacerCapital,
            currencyCode: resolveCorpLiquidCurrencyCode(placerCorp) ?? "USD",
            refs: { corporationId: corporation._id },
            delta: [
              { field: "orderType", before: null, after: "sell" },
              { field: "status", before: null, after: "filled" },
              { field: "shares", before: null, after: shares },
              { field: "pricePerShare", before: null, after: executionPrice },
            ],
            outcome: "ok",
          });
          return NextResponse.json({ success: true, filled: true, sharesSold: shares, proceeds });
        }
        // Reserve shares by debiting from corp position
        const reservedCorpShares = await debitSharesFromCorp(
          db,
          corporation._id,
          placerCorp._id,
          shares,
          {
            $set: { updatedAt: now },
          },
          { requireSufficient: true }
        );
        if (reservedCorpShares < 0) {
          return NextResponse.json(
            { error: "Shares were already sold or reserved by another action" },
            { status: 409 }
          );
        }
        try {
          await db.collection<ShareOrder>("shareOrders").insertOne({
            _id: new ObjectId(),
            corporationId: corporation._id,
            characterId: character._id,
            placerCorporationId: placerCorp._id,
            type: "sell",
            shares,
            sharesRemaining: shares,
            sharesDebitedAtCreation: true,
            pricePerShare,
            escrowAmount: 0,
            status: "open",
            createdAt: now,
            updatedAt: now,
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
        recordAudit({
          source: "api",
          action: "share.order",
          category: "market",
          subject: { type: "corporation", id: corporation._id, name: corporation.name },
          counterparty: { type: "corporation", id: placerCorp._id, name: placerCorp.name },
          refs: { corporationId: corporation._id },
          delta: [
            { field: "orderType", before: null, after: "sell" },
            { field: "status", before: null, after: "open" },
            { field: "shares", before: null, after: shares },
            { field: "pricePerShare", before: null, after: pricePerShare },
          ],
          outcome: "ok",
        });
        return NextResponse.json({ success: true, filled: false, sharesReserved: shares });
      }
    }

    // Load character FX rate once for all character wallet operations.
    // escrowAmount stored in DB is in the target corp's liquidCurrencyCode
    // (Option B). Wallet debits/credits hop through ₳ via targetFxRate.
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

    if (type === "buy") {
      // Check if fills immediately (current price <= limit)
      const fillsNow = executionPrice <= pricePerShare;
      const publicFloat = corporation.publicFloat ?? 0;

      if (fillsNow && publicFloat >= shares) {
        // Immediate fill at current market price
        const cost = shareTradeAnchorValue(
          shares,
          { ...corporation, sharePrice: executionPrice },
          targetFxRate
        );
        const costInHome = cost * charFxRate;
        // Atomic balance-gated debit on the buyer's wallet so concurrent
        // limit buys cannot both pass a stale balance check and overspend.
        const debitResult = await atomicallyDebitCharacterCash(
          db,
          character._id,
          homeCurrency,
          costInHome,
          forexEnabled
        );
        if (!debitResult.ok) {
          return NextResponse.json(
            { error: "Insufficient funds for immediate fill" },
            { status: 400 }
          );
        }
        let sharesCredited = false;
        try {
          const credited = await creditShares(
            db,
            corporation._id,
            character._id,
            shares,
            {
              $inc: {
                publicFloat: -shares,
                ...(orderFlowEligible ? { orderFlowWindowBuyValue: shares * executionPrice } : {}),
              },
              $set: { updatedAt: now },
            },
            {
              pricePerShare: executionPrice,
              guardFilter: { publicFloat: { $gte: shares } },
            }
          );
          if (!credited) {
            await refundCharacterCash(db, character._id, homeCurrency, costInHome, forexEnabled);
            return NextResponse.json(
              { error: "Not enough shares remain in public float" },
              { status: 409 }
            );
          }
          sharesCredited = true;
          void recordShareTrade(db, {
            corporationId: corporation._id,
            kind: "limit_fill",
            turn: currentTurn,
            shares,
            pricePerShareAnchor: cost / shares,
            from: null,
            to: { characterId: character._id, name: character.name },
            corpCurrencyCode: corporation.liquidCurrencyCode,
          });
          await emitTx(db, {
            type: "stock_trade_buy",
            turn: currentTurn,
            createdAt: now,
            subjectType: "character",
            subjectId: character._id,
            subjectName: character.name,
            amount: -costInHome,
            balanceAfter: debitResult.newBalance,
            currencyCode: homeCurrency,
            counterpartyType: "corporation",
            counterpartyId: corporation._id,
            counterpartyName: corporation.name,
            meta: {
              corporationId: corporation._id.toString(),
              shares,
              pricePerShare: executionPrice,
              source: "limit_order_immediate_fill",
            },
          });

          // Treasury-backed market maker: inject the buyer's payment into the
          // issuer treasury. Last in the try — a throw rolls back via the catch.
          await applyFloatBuyCredit(db, corporation, shares * executionPrice);
        } catch (err) {
          if (sharesCredited) {
            await debitShares(
              db,
              corporation._id,
              character._id,
              shares,
              {
                $inc: {
                  publicFloat: shares,
                  ...(orderFlowEligible
                    ? { orderFlowWindowBuyValue: -(shares * executionPrice) }
                    : {}),
                },
                $set: { updatedAt: new Date() },
              },
              { requireSufficient: true }
            );
          }
          await refundCharacterCash(db, character._id, homeCurrency, costInHome, forexEnabled);
          throw err;
        }

        recordAudit({
          source: "api",
          action: "share.order",
          category: "market",
          subject: { type: "corporation", id: corporation._id, name: corporation.name },
          counterparty: { type: "character", id: character._id, name: character.name },
          amount: -costInHome,
          currencyCode: homeCurrency,
          refs: { corporationId: corporation._id },
          delta: [
            { field: "orderType", before: null, after: "buy" },
            { field: "status", before: null, after: "filled" },
            { field: "shares", before: null, after: shares },
            { field: "pricePerShare", before: null, after: executionPrice },
          ],
          outcome: "ok",
        });
        return NextResponse.json({
          success: true,
          filled: true,
          sharesBought: shares,
          cost: Math.round(cost * 100) / 100,
        });
      }

      // Pending buy order — escrow stored in target corp's local currency
      // (Option B). Wallet debit converts local → ₳ → char home via the
      // target's FX; the stored escrowAmount is FX-stable against fill cost
      // because both are `shares × pricePerShare` in the same currency.
      const escrowAmount = shares * pricePerShare;
      const escrowAnchor = corpLiquidCapitalToAnchor(escrowAmount, corporation, targetFxRate);
      const escrowInHome = escrowAnchor * charFxRate;
      const escrowDebit = await atomicallyDebitCharacterCash(
        db,
        character._id,
        homeCurrency,
        escrowInHome,
        forexEnabled
      );
      if (!escrowDebit.ok) {
        return NextResponse.json(
          {
            error: `Insufficient funds. Need ${escrowInHome.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${homeCurrency} in escrow`,
          },
          { status: 400 }
        );
      }
      try {
        await db.collection<ShareOrder>("shareOrders").insertOne({
          _id: new ObjectId(),
          corporationId: corporation._id,
          characterId: character._id,
          type: "buy",
          shares,
          sharesRemaining: shares,
          pricePerShare,
          escrowAmount,
          status: "open",
          createdAt: now,
          updatedAt: now,
        });
        await emitTx(db, {
          type: "stock_order_escrow",
          turn: currentTurn,
          createdAt: now,
          subjectType: "character",
          subjectId: character._id,
          subjectName: character.name,
          amount: -escrowInHome,
          balanceAfter: escrowDebit.newBalance,
          currencyCode: homeCurrency,
          counterpartyType: "system",
          counterpartyName: "Order book escrow",
          meta: {
            corporationId: corporation._id.toString(),
            shares,
            pricePerShare,
          },
        });
      } catch (err) {
        await refundCharacterCash(db, character._id, homeCurrency, escrowInHome, forexEnabled);
        throw err;
      }

      recordAudit({
        source: "api",
        action: "share.order",
        category: "market",
        subject: { type: "corporation", id: corporation._id, name: corporation.name },
        counterparty: { type: "character", id: character._id, name: character.name },
        amount: -escrowInHome,
        currencyCode: homeCurrency,
        refs: { corporationId: corporation._id },
        delta: [
          { field: "orderType", before: null, after: "buy" },
          { field: "status", before: null, after: "open" },
          { field: "shares", before: null, after: shares },
          { field: "pricePerShare", before: null, after: pricePerShare },
        ],
        outcome: "ok",
      });
      return NextResponse.json({ success: true, filled: false, escrowAmount });
    } else {
      // Sell order — validate and reserve shares
      const shareholderEntry = corporation.shareholders?.find(
        (sh) => sh.characterId?.toString() === character._id.toString()
      );
      const ownedShares = shareholderEntry?.shares ?? 0;

      // Also check for already-reserved shares in open sell orders
      const openSellOrders = await db
        .collection<ShareOrder>("shareOrders")
        .find({
          corporationId: corporation._id,
          characterId: character._id,
          type: "sell",
          status: "open",
        })
        .toArray();
      const alreadyReserved = openSellOrders.reduce(
        (sum, o) => sum + (o.sharesDebitedAtCreation ? 0 : o.sharesRemaining),
        0
      );
      const availableShares = ownedShares - alreadyReserved;

      if (availableShares < shares) {
        return NextResponse.json(
          {
            error: `Only ${availableShares.toLocaleString()} shares available (${alreadyReserved.toLocaleString()} reserved in open orders)`,
          },
          { status: 400 }
        );
      }

      // Check if fills immediately (current price >= limit)
      const fillsNow = executionPrice >= pricePerShare;

      if (fillsNow) {
        // Immediate fill at current market price
        const proceeds = shareTradeAnchorValue(
          shares,
          { ...corporation, sharePrice: executionPrice },
          targetFxRate
        );
        const proceedsInHome = proceeds * charFxRate;

        const buybackGate = await gateIssuerBuyback();
        if (buybackGate) return buybackGate;

        // Atomically debit shares from seller and increment public float
        const remainingAfterSale = await debitShares(
          db,
          corporation._id,
          character._id,
          shares,
          {
            $inc: {
              publicFloat: shares,
              ...(orderFlowEligible ? { orderFlowWindowSellValue: shares * executionPrice } : {}),
            },
            $set: { updatedAt: now },
          },
          { requireSufficient: true }
        );
        if (remainingAfterSale < 0) {
          await reverseFloatSellDebit(db, corporation, issuerBuyback, {
            split: issuerBuybackSplit,
          });
          return NextResponse.json(
            { error: "Shares were already sold or reserved by another action" },
            { status: 409 }
          );
        }
        let sellerCredited = false;
        try {
          const sellerCredit = await db.collection<Character>("characters").updateOne(
            { _id: character._id },
            {
              $inc: buildPersonalBalanceInc(proceedsInHome, homeCurrency, forexEnabled),
              $set: { updatedAt: now },
            }
          );
          if (sellerCredit.matchedCount === 0) {
            throw new Error("Seller character not found");
          }
          sellerCredited = true;

          void recordShareTrade(db, {
            corporationId: corporation._id,
            kind: "limit_fill",
            turn: currentTurn,
            shares,
            pricePerShareAnchor: proceeds / shares,
            from: { characterId: character._id, name: character.name },
            to: null,
            corpCurrencyCode: corporation.liquidCurrencyCode,
          });
          await emitTx(db, {
            type: "stock_trade_sell",
            turn: currentTurn,
            createdAt: now,
            subjectType: "character",
            subjectId: character._id,
            subjectName: character.name,
            amount: proceedsInHome,
            currencyCode: homeCurrency,
            counterpartyType: "corporation",
            counterpartyId: corporation._id,
            counterpartyName: corporation.name,
            meta: {
              corporationId: corporation._id.toString(),
              shares,
              pricePerShare: executionPrice,
              source: "limit_order_immediate_fill",
            },
          });
        } catch (err) {
          if (sellerCredited) {
            await db.collection<Character>("characters").updateOne(
              { _id: character._id },
              {
                $inc: buildPersonalBalanceInc(-proceedsInHome, homeCurrency, forexEnabled),
                $set: { updatedAt: new Date() },
              }
            );
          }
          await creditShares(
            db,
            corporation._id,
            character._id,
            shares,
            {
              $inc: {
                publicFloat: -shares,
                ...(orderFlowEligible
                  ? { orderFlowWindowSellValue: -(shares * executionPrice) }
                  : {}),
              },
              $set: { updatedAt: new Date() },
            },
            { pricePerShare: shareholderEntry?.avgCostPerShare ?? executionPrice }
          );
          await reverseFloatSellDebit(db, corporation, issuerBuyback, {
            split: issuerBuybackSplit,
          });
          throw err;
        }

        // Sell-fill committed (character): back out realized issuance proceeds to
        // match the float shrinking (mirrors the buy-side credit). Best-effort/terminal.
        void onFloatSellCommitted(db, corporation, issuerBuyback);
        recordAudit({
          source: "api",
          action: "share.order",
          category: "market",
          subject: { type: "corporation", id: corporation._id, name: corporation.name },
          counterparty: { type: "character", id: character._id, name: character.name },
          amount: proceedsInHome,
          currencyCode: homeCurrency,
          refs: { corporationId: corporation._id },
          delta: [
            { field: "orderType", before: null, after: "sell" },
            { field: "status", before: null, after: "filled" },
            { field: "shares", before: null, after: shares },
            { field: "pricePerShare", before: null, after: executionPrice },
          ],
          outcome: "ok",
        });
        return NextResponse.json({
          success: true,
          filled: true,
          sharesSold: shares,
          proceeds: Math.round(proceeds * 100) / 100,
        });
      }

      // Pending sell: debit holdings now and set sharesDebitedAtCreation so
      // fill does not debit again. Cancel restores the shares.
      const reservedShares = await debitShares(
        db,
        corporation._id,
        character._id,
        shares,
        { $set: { updatedAt: now } },
        { requireSufficient: true }
      );
      if (reservedShares < 0) {
        return NextResponse.json(
          { error: "Shares were already sold or reserved by another action" },
          { status: 409 }
        );
      }
      try {
        await db.collection<ShareOrder>("shareOrders").insertOne({
          _id: new ObjectId(),
          corporationId: corporation._id,
          characterId: character._id,
          type: "sell",
          shares,
          sharesRemaining: shares,
          sharesDebitedAtCreation: true,
          pricePerShare,
          escrowAmount: 0,
          status: "open",
          createdAt: now,
          updatedAt: now,
        });
      } catch (error) {
        await creditShares(
          db,
          corporation._id,
          character._id,
          shares,
          { $set: { updatedAt: new Date() } },
          { pricePerShare: shareholderEntry?.avgCostPerShare ?? executionPrice }
        );
        throw error;
      }

      recordAudit({
        source: "api",
        action: "share.order",
        category: "market",
        subject: { type: "corporation", id: corporation._id, name: corporation.name },
        counterparty: { type: "character", id: character._id, name: character.name },
        refs: { corporationId: corporation._id },
        delta: [
          { field: "orderType", before: null, after: "sell" },
          { field: "status", before: null, after: "open" },
          { field: "shares", before: null, after: shares },
          { field: "pricePerShare", before: null, after: pricePerShare },
        ],
        outcome: "ok",
      });
      return NextResponse.json({ success: true, filled: false, sharesReserved: shares });
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
