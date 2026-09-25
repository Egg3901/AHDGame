import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character, Corporation, IndexFund, ShareOrder } from "@/lib/db/types";
import { emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import { buildPersonalBalanceBulkOp } from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  anchorToCorpCapital,
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { recoverShareFillOrphans } from "@/lib/corporations/commands/shareTrading/shareFillAudit";
import { recordShareTrades } from "@/lib/corporations/shareTradeHistory";
import type { ShareTradeParty } from "@/lib/db/types/shareTradeHistory";
import { loadEquityPoolsByCurrency, loadEquityQuote } from "@/lib/equities/marketPool";
import {
  allocateEquityPoolSellBudgets,
  type EquityPoolSellDemand,
} from "@/lib/equities/equityPoolSellAllocation";
import type { EquityMarketPool } from "@/lib/db/types";
import { EQUITY_MARKET_POOLS_COLLECTION } from "@/lib/db/types/equityMarketPool";

/** Per-character delta for a corp, plus the fill price for new-entry cost basis. */
interface ShareDelta {
  delta: number;
  /**
   * Per-share fill price (₳). Set when this delta *increases* a holding (buy fill)
   * so we can stamp `avgCostPerShare` on a brand-new pushed entry and match the
   * convention used by the direct-buy route. Not tracked for sells (decrement only).
   */
  pricePerShare?: number;
}

/**
 * One queued trade-history emission collected during fill resolution.
 * Names are resolved in a batch lookup after all fills are applied.
 */
interface PendingHistoryEmit {
  corporationId: ObjectId;
  kind: "limit_fill";
  shares: number;
  pricePerShareAnchor: number;
  corpCurrencyCode?: CurrencyCode;
  /** Populated with a resolved name before insert. */
  fromPartyRef?: { characterId?: ObjectId; corporationId?: ObjectId };
  toPartyRef?: { characterId?: ObjectId; corporationId?: ObjectId };
}

/**
 * Check all open share orders and fill any that match the current market price.
 * Buy orders fill when sharePrice <= pricePerShare (and public float has enough shares).
 * Sell orders fill when sharePrice >= pricePerShare (proceeds credited to seller).
 *
 * `turn` is stamped on every emitted `shareTradeHistory` row.
 */
export async function fillPendingShareOrders(db: Db, now: Date, turn: number): Promise<void> {
  // Peer-fill orphan recovery (issue #1672, slice 1): route and market-sell
  // fills stamp one attempt key per fill and persist convergent audit rows
  // under it. The per-order stamp hook covers orders that see another fill;
  // this bounded scan re-drives lonely receipts (order already filled) once
  // per turn before the fresh scan. Best-effort: recovery never fails the
  // matcher; unrecovered receipts stay `in_progress` for the next turn.
  try {
    await recoverShareFillOrphans(db, 50);
  } catch {
    // Receipts stay `in_progress` for the next turn.
  }

  // Fill decisions and their escrow/history writes only use these order
  // fields; the query filter still applies `status` server-side.
  const openOrders = await db
    .collection<ShareOrder>("shareOrders")
    .find(
      { status: "open" },
      {
        projection: {
          _id: 1,
          characterId: 1,
          corporationId: 1,
          escrowAmount: 1,
          escrowAnchor: 1,
          placerCorporationId: 1,
          placerFundId: 1,
          pricePerShare: 1,
          sharesDebitedAtCreation: 1,
          sharesRemaining: 1,
          type: 1,
        },
      }
    )
    .toArray();

  if (openOrders.length === 0) return;

  // Group orders by corporationId
  const ordersByCorp = new Map<string, typeof openOrders>();
  for (const order of openOrders) {
    const key = order.corporationId.toString();
    const list = ordersByCorp.get(key) ?? [];
    list.push(order);
    ordersByCorp.set(key, list);
  }

  const corpIds = [...ordersByCorp.keys()].map((k) => new ObjectId(k));
  // Keep the full shareholder array for live holding caps. Other corporation
  // payload fields are not read by this matcher.
  const corpDocs = await db
    .collection<Corporation>("corporations")
    .find(
      { _id: { $in: corpIds } },
      {
        projection: {
          _id: 1,
          countryId: 1,
          liquidCurrencyCode: 1,
          fundamentalSharePrice: 1,
          publicFloat: 1,
          sharePrice: 1,
          totalShares: 1,
          liquidCapital: 1,
          shareholders: 1,
        },
      }
    )
    .toArray();
  const corpMap = new Map(corpDocs.map((c) => [c._id.toString(), c]));

  // Pre-load FX rates once so we can normalize each fill's local-currency
  // amount to ₳ before aggregating (Option B — order.pricePerShare and
  // order.escrowAmount are in each target corp's liquidCurrencyCode, and
  // adjustments here batch across corps of different currencies).
  const fxByCurrency = await loadFxRatesByCurrency(db);

  // All maps below store ₳. Each contribution converts from target-corp-local
  // to ₳ at attribution time; payout converts ₳ → payee's home currency.
  const charCashAdjustments = new Map<string, number>();
  // liquidCapital adjustments for corporations that placed sell orders
  const corpCashAdjustments = new Map<string, number>(); // placerCorpId -> proceeds
  // shareholder updates per corporation (track incrementally), carrying fill price
  const corpShareholderUpdates = new Map<string, Map<string, ShareDelta>>();
  const corpFloatDeltas = new Map<string, number>(); // corpId -> publicFloat delta
  // Treasury-backed market maker: issuer liquidCapital delta from float fills.
  // Buy fills credit the issuer (the buyer's payment); sell fills debit it,
  // capped at the issuer's treasury, so a limit order can't mint money via the
  // float the way the market-sell cap already prevents.
  const corpTreasuryDeltas = new Map<string, number>(); // corpId -> liquidCapital delta (local)
  const poolCashRemaining = new Map<CurrencyCode, number>();
  const poolFlows = new Map<CurrencyCode, { purchasesIn: number; salesOut: number }>();
  // ── Index-fund-owned buy orders ──────────────────────────────────────────
  // Fund share credits per corp (corp → fund → ShareDelta) applied after the
  // corp bulk writes via creditSharesToFund.
  const fundShareholderUpdates = new Map<string, Map<string, ShareDelta>>();
  // Unused-escrow refunds per fund (fundId → ₳ refund) credited back to cashAnchor.
  const fundCashAdjustments = new Map<string, number>();
  const historyEmits: PendingHistoryEmit[] = [];

  const orderFillOps: {
    updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> };
  }[] = [];

  // One pool document per currency; read them once for the whole loop.
  const equityPools = await loadEquityPoolsByCurrency(db);
  const marketQuotesByCorp = new Map<string, Awaited<ReturnType<typeof loadEquityQuote>>>();
  const sellDemands: EquityPoolSellDemand[] = [];

  // Allocate the opening pool cash before resolving any order. Without this
  // pass, the first corporation in Mongo's order is able to consume all of a
  // currency's cash and later corporations receive no bid at all.
  for (const [corpIdStr, orders] of ordersByCorp) {
    const corp = corpMap.get(corpIdStr);
    if (!corp) continue;

    const marketQuote = await loadEquityQuote(db, corp, { pools: equityPools });
    marketQuotesByCorp.set(corpIdStr, marketQuote);
    if (!marketQuote.active || !(marketQuote.bidPriceLocal > 0)) continue;

    const remainingCharacterShares = new Map<string, number>();
    let notionalLocal = 0;
    for (const order of orders) {
      if (
        order.type !== "sell" ||
        order.placerFundId ||
        marketQuote.bidPriceLocal < order.pricePerShare
      ) {
        continue;
      }

      let shares = Math.max(0, order.sharesRemaining);
      if (
        !order.placerCorporationId &&
        order.characterId &&
        order.sharesDebitedAtCreation !== true
      ) {
        const sellerId = order.characterId.toString();
        const knownShares = remainingCharacterShares.has(sellerId)
          ? remainingCharacterShares.get(sellerId)!
          : Math.max(
              0,
              (corp.shareholders ?? []).find(
                (shareholder) => shareholder.characterId?.toString() === sellerId
              )?.shares ?? 0
            );
        shares = Math.min(shares, knownShares);
        remainingCharacterShares.set(sellerId, Math.max(0, knownShares - shares));
      }
      notionalLocal += shares * marketQuote.bidPriceLocal;
    }

    if (Number.isFinite(notionalLocal) && notionalLocal > 0) {
      sellDemands.push({
        currency: marketQuote.currency,
        corporationId: corpIdStr,
        notionalLocal,
      });
    }
  }

  const openingPoolCash = new Map<CurrencyCode, number>();
  for (const [currency, pool] of equityPools) {
    openingPoolCash.set(currency, Math.max(0, pool.cashLocal ?? 0));
    poolCashRemaining.set(currency, Math.max(0, pool.cashLocal ?? 0));
  }
  const sellBudgetRemaining = allocateEquityPoolSellBudgets({
    cashByCurrency: openingPoolCash,
    demands: sellDemands,
  });

  for (const [corpIdStr, orders] of ordersByCorp) {
    const corp = corpMap.get(corpIdStr);
    if (!corp) continue;

    const marketQuote = marketQuotesByCorp.get(corpIdStr);
    if (!marketQuote) continue;
    // Target corp's FX rate, applied to every local-currency amount in this
    // corp's fill loop (price × shares, escrow diffs, proceeds).
    const targetFxRate = fxRateForCorpFromMap(corp, fxByCurrency);
    let availableFloat: number = corp.publicFloat ?? 0;
    // Running issuer treasury (local currency) — sell fills are capped to it,
    // buy fills top it up. Starts from the corp's current liquidCapital.
    let treasuryRemaining = corp.liquidCapital ?? 0;
    let treasuryDelta = 0;
    const corpCurrencyCode = resolveCorpLiquidCurrencyCode(corp) as CurrencyCode | undefined;

    for (const order of orders) {
      const charIdStr = order.characterId?.toString();
      const currentPrice =
        order.type === "buy" ? marketQuote.askPriceLocal : marketQuote.bidPriceLocal;

      if (order.type === "buy" && currentPrice <= order.pricePerShare) {
        // Fill buy order if public float has shares
        const toFill = Math.min(order.sharesRemaining, availableFloat);
        if (toFill <= 0) continue;

        const actualCostLocal = toFill * currentPrice;
        const filled = toFill >= order.sharesRemaining;
        // Refund only the FILLED shares' below-limit savings (paid limit price,
        // executed at lower market price). The branch guard guarantees
        // currentPrice <= order.pricePerShare, so this is >= 0. For a full fill
        // this equals the old `order.escrowAmount - actualCostLocal`. On a
        // partial fill, the unfilled shares' escrow stays reserved on the order
        // (see escrowAmount/escrowAnchor below) so cancel refunds it later —
        // refunding the whole remainder here would double-count it.
        const refundLocal = toFill * (order.pricePerShare - currentPrice); // local currency
        // Share-proportional residual escrow for the unfilled portion (FX-stable).
        const unfilledFraction = (order.sharesRemaining - toFill) / order.sharesRemaining;
        const residualEscrowLocal = order.escrowAmount * unfilledFraction;
        const residualEscrowAnchor = (order.escrowAnchor ?? 0) * unfilledFraction;

        if (order.placerFundId) {
          // ── Index-fund-owned buy fill ────────────────────────────────────
          // Mirrors the character path exactly, but credits go to the fund's
          // cap-table entry (fundId) and unused-escrow refunds go to the fund's
          // cashAnchor. Treasury/float deltas are identical to a char buy, so
          // the issuer still receives the buyer payment (money conserved).
          const fundIdStr = order.placerFundId.toString();
          const fundDelta = fundShareholderUpdates.get(corpIdStr) ?? new Map<string, ShareDelta>();
          const existingFund = fundDelta.get(fundIdStr) ?? { delta: 0 };
          fundDelta.set(fundIdStr, {
            delta: existingFund.delta + toFill,
            pricePerShare: currentPrice,
          });
          fundShareholderUpdates.set(corpIdStr, fundDelta);

          if (refundLocal > 0) {
            const refundAnchor = corpLiquidCapitalToAnchor(refundLocal, corp, targetFxRate);
            fundCashAdjustments.set(
              fundIdStr,
              (fundCashAdjustments.get(fundIdStr) ?? 0) + refundAnchor
            );
          }

          availableFloat -= toFill;
          corpFloatDeltas.set(corpIdStr, (corpFloatDeltas.get(corpIdStr) ?? 0) - toFill);

          if (marketQuote.active) {
            poolCashRemaining.set(
              marketQuote.currency,
              (poolCashRemaining.get(marketQuote.currency) ?? 0) + actualCostLocal
            );
            const flow = poolFlows.get(marketQuote.currency) ?? {
              purchasesIn: 0,
              salesOut: 0,
            };
            flow.purchasesIn += actualCostLocal;
            poolFlows.set(marketQuote.currency, flow);
          } else {
            treasuryRemaining += actualCostLocal;
            treasuryDelta += actualCostLocal;
          }

          historyEmits.push({
            corporationId: new ObjectId(corpIdStr),
            kind: "limit_fill",
            shares: toFill,
            pricePerShareAnchor: corpLiquidCapitalToAnchor(currentPrice, corp, targetFxRate),
            corpCurrencyCode,
            // Fund holders aren't a char/corp party ref; record float→null buy.
            toPartyRef: undefined,
          });

          // Reserve the unfilled shares' escrow (both local and anchor) on
          // partial fills so a later cancel refunds exactly that portion.
          orderFillOps.push({
            updateOne: {
              filter: { _id: order._id },
              update: {
                $set: {
                  sharesRemaining: filled ? 0 : order.sharesRemaining - toFill,
                  escrowAmount: filled ? 0 : residualEscrowLocal,
                  escrowAnchor: filled ? 0 : residualEscrowAnchor,
                  status: filled ? "filled" : "open",
                  updatedAt: now,
                },
              },
            },
          });
          continue;
        }

        if (!charIdStr) continue;

        // Credit shares. Record the fill price so a brand-new shareholder entry
        // gets its avgCostPerShare stamped (matches /shares/buy convention).
        const delta = corpShareholderUpdates.get(corpIdStr) ?? new Map<string, ShareDelta>();
        const existing = delta.get(charIdStr) ?? { delta: 0 };
        delta.set(charIdStr, {
          delta: existing.delta + toFill,
          pricePerShare: currentPrice,
        });
        corpShareholderUpdates.set(corpIdStr, delta);

        // Refund unused escrow (paid limit price, filled at lower market price).
        // Normalize local → ₳ so the per-character map can aggregate correctly
        // across fills in multiple target currencies.
        if (refundLocal > 0) {
          const refundAnchor = corpLiquidCapitalToAnchor(refundLocal, corp, targetFxRate);
          charCashAdjustments.set(
            charIdStr,
            (charCashAdjustments.get(charIdStr) ?? 0) + refundAnchor
          );
        }

        availableFloat -= toFill;
        corpFloatDeltas.set(corpIdStr, (corpFloatDeltas.get(corpIdStr) ?? 0) - toFill);

        if (marketQuote.active) {
          poolCashRemaining.set(
            marketQuote.currency,
            (poolCashRemaining.get(marketQuote.currency) ?? 0) + actualCostLocal
          );
          const flow = poolFlows.get(marketQuote.currency) ?? { purchasesIn: 0, salesOut: 0 };
          flow.purchasesIn += actualCostLocal;
          poolFlows.set(marketQuote.currency, flow);
        } else {
          treasuryRemaining += actualCostLocal;
          treasuryDelta += actualCostLocal;
        }

        // Queue history entry — buy: from = float (null), to = character.
        // currentPrice (= corp.sharePrice) is stored in the target corp's
        // liquidCurrencyCode (Option B, v0.2.6); convert to ₳ for the audit row.
        historyEmits.push({
          corporationId: new ObjectId(corpIdStr),
          kind: "limit_fill",
          shares: toFill,
          pricePerShareAnchor: corpLiquidCapitalToAnchor(currentPrice, corp, targetFxRate),
          corpCurrencyCode,
          toPartyRef: { characterId: order.characterId },
        });

        orderFillOps.push({
          updateOne: {
            filter: { _id: order._id },
            update: {
              $set: {
                sharesRemaining: filled ? 0 : order.sharesRemaining - toFill,
                escrowAmount: filled ? 0 : residualEscrowLocal,
                status: filled ? "filled" : "open",
                updatedAt: now,
              },
            },
          },
        });
      } else if (order.type === "sell" && currentPrice >= order.pricePerShare) {
        // Fund-owned asks are executable peer quotes. They intentionally do
        // not auto-fill against the issuer treasury: doing so would guarantee
        // the liquidity provider an exit and would bypass the guarded dual
        // debit of its cap-table and fund holdings ledgers.
        if (order.placerFundId) continue;
        // Fill sell order at the executable bid (which is at least the seller's
        // limit), add the shares to public float, and pay the seller.
        // Character sell orders are not debited at placement, so a reverse split
        // (or any later sale) can leave sharesRemaining far above the live
        // holding. Capping here stops the fill from driving the seller negative
        // and dumping a pre-split share count into the float (ticket #1154).
        let toFill = order.sharesRemaining;
        if (!order.placerCorporationId && charIdStr && order.sharesDebitedAtCreation !== true) {
          const held =
            (corp.shareholders ?? []).find((sh) => sh.characterId?.toString() === charIdStr)
              ?.shares ?? 0;
          const alreadyDebited = corpShareholderUpdates.get(corpIdStr)?.get(charIdStr)?.delta ?? 0;
          const available = Math.max(0, held + alreadyDebited);
          toFill = Math.min(toFill, available);
        }
        if (marketQuote.active) {
          const corporationBudget =
            sellBudgetRemaining.get(marketQuote.currency)?.get(corpIdStr) ?? 0;
          const cashAvailable = Math.min(
            poolCashRemaining.get(marketQuote.currency) ?? 0,
            corporationBudget
          );
          const cashLimitedShares =
            currentPrice > 0 ? Math.floor((cashAvailable + 1e-9) / currentPrice) : 0;
          toFill = Math.min(toFill, cashLimitedShares);
        }
        if (toFill <= 0) continue;

        const proceedsLocal = toFill * currentPrice;
        if (marketQuote.active) {
          const remainingCash = poolCashRemaining.get(marketQuote.currency) ?? 0;
          poolCashRemaining.set(marketQuote.currency, remainingCash - proceedsLocal);
          const currencyBudgets = sellBudgetRemaining.get(marketQuote.currency);
          if (currencyBudgets) {
            const remainingBudget = currencyBudgets.get(corpIdStr) ?? 0;
            currencyBudgets.set(corpIdStr, Math.max(0, remainingBudget - proceedsLocal));
          }
          const flow = poolFlows.get(marketQuote.currency) ?? { purchasesIn: 0, salesOut: 0 };
          flow.salesOut += proceedsLocal;
          poolFlows.set(marketQuote.currency, flow);
        } else {
          // Compatibility fallback for worlds without a pool.
          if (treasuryRemaining < proceedsLocal) continue;
          treasuryRemaining -= proceedsLocal;
          treasuryDelta -= proceedsLocal;
        }
        const proceedsAnchor = corpLiquidCapitalToAnchor(proceedsLocal, corp, targetFxRate);

        // Corp sell orders: pay the placing corporation, not the CEO character.
        // Character sell orders: pay the character directly.
        if (order.placerCorporationId) {
          const placerIdStr = order.placerCorporationId.toString();
          corpCashAdjustments.set(
            placerIdStr,
            (corpCashAdjustments.get(placerIdStr) ?? 0) + proceedsAnchor
          );
        } else if (charIdStr) {
          charCashAdjustments.set(
            charIdStr,
            (charCashAdjustments.get(charIdStr) ?? 0) + proceedsAnchor
          );
        }

        // Shares go to public float
        availableFloat += toFill;
        corpFloatDeltas.set(corpIdStr, (corpFloatDeltas.get(corpIdStr) ?? 0) + toFill);

        // Corp sell orders already debited shares from the corp's shareholder
        // entry at order-creation time. New character sell orders do the same;
        // legacy rows without the marker only reserved shares and still need a
        // debit at fill time.
        if (!order.placerCorporationId && charIdStr && order.sharesDebitedAtCreation !== true) {
          const delta = corpShareholderUpdates.get(corpIdStr) ?? new Map<string, ShareDelta>();
          const existing = delta.get(charIdStr) ?? { delta: 0 };
          delta.set(charIdStr, { delta: existing.delta - toFill });
          corpShareholderUpdates.set(corpIdStr, delta);
        }

        // Queue history entry — sell: from = seller, to = float (null).
        // order.pricePerShare is stored in the target corp's liquidCurrencyCode
        // (Option B); convert to ₳ for the audit row.
        historyEmits.push({
          corporationId: new ObjectId(corpIdStr),
          kind: "limit_fill",
          shares: toFill,
          pricePerShareAnchor: corpLiquidCapitalToAnchor(currentPrice, corp, targetFxRate),
          corpCurrencyCode,
          fromPartyRef: order.placerCorporationId
            ? { corporationId: order.placerCorporationId }
            : { characterId: order.characterId },
        });

        const filled = toFill >= order.sharesRemaining;
        orderFillOps.push({
          updateOne: {
            filter: { _id: order._id },
            update: {
              $set: {
                sharesRemaining: filled ? 0 : order.sharesRemaining - toFill,
                status: filled ? "filled" : "open",
                updatedAt: now,
              },
            },
          },
        });
      }
    }

    if (treasuryDelta !== 0) corpTreasuryDeltas.set(corpIdStr, treasuryDelta);
  }

  // Commit each currency's net dealer cash leg before any shares move. The
  // turn lock prevents API trades from interleaving; the filter is still a
  // final guard against an unexpected concurrent debit.
  for (const [currency, flow] of poolFlows) {
    const purchasesIn = Math.round(flow.purchasesIn * 100) / 100;
    const salesOut = Math.round(flow.salesOut * 100) / 100;
    const net = Math.round((purchasesIn - salesOut) * 100) / 100;
    const update = await db.collection<EquityMarketPool>(EQUITY_MARKET_POOLS_COLLECTION).updateOne(
      {
        _id: currency,
        ...(net < 0 ? { cashLocal: { $gte: -net } } : {}),
      },
      {
        $inc: {
          cashLocal: net,
          ...(purchasesIn > 0 ? { "lifetime.purchasesIn": purchasesIn } : {}),
          ...(salesOut > 0 ? { "lifetime.salesOut": salesOut } : {}),
        },
        $set: { updatedAt: now },
      }
    );
    if (update.matchedCount !== 1) {
      throw new Error(`Equity market pool ${currency} could not settle queued share orders`);
    }
  }

  // Apply corporation shareholder updates atomically (per-character positional ops)
  // Phase 1: $inc existing shareholder entries + float/trade updates per corp
  const incOps: {
    updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> };
  }[] = [];
  // Track which (corp, char) pairs need a $push if they don't have an existing entry.
  // pricePerShare (₳) is stamped on the new entry as avgCostPerShare so portfolio
  // cost-basis / PnL display works for orders filled by the turn processor.
  const pushNeeded: {
    corpId: ObjectId;
    charId: ObjectId;
    delta: number;
    pricePerShare?: number;
  }[] = [];

  for (const [corpIdStr, charDeltas] of corpShareholderUpdates) {
    const corp = corpMap.get(corpIdStr);
    if (!corp) continue;

    const existingCharIds = new Set(
      (corp.shareholders ?? [])
        .filter((sh) => sh.characterId)
        .map((sh) => sh.characterId!.toString())
    );

    const floatDelta = corpFloatDeltas.get(corpIdStr) ?? 0;

    // One update per corp for float delta
    if (floatDelta !== 0) {
      incOps.push({
        updateOne: {
          filter: { _id: new ObjectId(corpIdStr) },
          update: {
            $inc: { publicFloat: floatDelta },
            $set: { updatedAt: now },
          },
        },
      });
    }

    for (const [charIdStr, { delta, pricePerShare }] of charDeltas) {
      if (existingCharIds.has(charIdStr)) {
        // Atomic positional $inc on existing entry
        incOps.push({
          updateOne: {
            filter: {
              _id: new ObjectId(corpIdStr),
              "shareholders.characterId": new ObjectId(charIdStr),
            },
            update: {
              $inc: { "shareholders.$.shares": delta },
              $set: { updatedAt: now },
            },
          },
        });
      } else {
        pushNeeded.push({
          corpId: new ObjectId(corpIdStr),
          charId: new ObjectId(charIdStr),
          delta,
          pricePerShare,
        });
      }
    }
  }

  // Apply float deltas for corps with only sell-order fills (no buy-order shareholder changes)
  for (const [corpIdStr, floatDelta] of corpFloatDeltas) {
    if (!corpShareholderUpdates.has(corpIdStr) && floatDelta !== 0) {
      incOps.push({
        updateOne: {
          filter: { _id: new ObjectId(corpIdStr) },
          update: {
            $inc: { publicFloat: floatDelta },
            $set: { updatedAt: now },
          },
        },
      });
    }
  }

  if (orderFillOps.length > 0) {
    await db.collection("shareOrders").bulkWrite(orderFillOps);
  }
  if (incOps.length > 0) {
    await db.collection("corporations").bulkWrite(incOps);
  }
  // Phase 2: $push for new shareholder entries that didn't exist at read time.
  // Include avgCostPerShare so the pushed entry matches the shape /shares/buy
  // writes — otherwise portfolio PnL display shows "-" for these holdings.
  if (pushNeeded.length > 0) {
    const pushOps = pushNeeded.map(({ corpId, charId, delta, pricePerShare }) => ({
      updateOne: {
        filter: { _id: corpId },
        update: {
          $push: {
            shareholders: {
              characterId: charId,
              shares: delta,
              ...(pricePerShare !== undefined ? { avgCostPerShare: pricePerShare } : {}),
            },
          },
          $set: { updatedAt: now },
        },
      },
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.collection("corporations").bulkWrite(pushOps as any[]);
  }
  if (charCashAdjustments.size > 0) {
    const forexEnabled = await isForexEnabled();
    const adjCharIds = [...charCashAdjustments.keys()].map((id) => new ObjectId(id));
    const adjChars = await db
      .collection<Character>("characters")
      .find({ _id: { $in: adjCharIds } })
      .project<{ _id: ObjectId; countryId: string }>({ _id: 1, countryId: 1 })
      .toArray();
    const charCountryMap = new Map(adjChars.map((c) => [c._id.toString(), c.countryId]));

    // Map values are ₳ (normalized at attribution). Convert to each character's
    // home currency for the wallet credit.
    const charOps = [...charCashAdjustments.entries()].map(([charIdStr, amountAnchor]) => {
      const countryId = charCountryMap.get(charIdStr) ?? "US";
      const currency: CurrencyCode =
        COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP] ?? "USD";
      const rate = fxByCurrency.get(currency) ?? 1.0;
      const amountInCurrency = forexEnabled ? amountAnchor * rate : amountAnchor;
      return buildPersonalBalanceBulkOp(
        new ObjectId(charIdStr),
        amountInCurrency,
        currency,
        forexEnabled
      );
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.collection("characters").bulkWrite(charOps as any);
  }

  // Pay corporations that had sell orders filled (proceeds → liquidCapital).
  // Map values are ₳ (normalized at attribution); each corp's liquidCapital is
  // in its home currency, so convert on payout.
  if (corpCashAdjustments.size > 0) {
    const corpPayOps = [...corpCashAdjustments.entries()].map(([corpIdStr, amount]) => {
      const corp = corpMap.get(corpIdStr);
      // Use the resolver so corps with `countryId` but no `liquidCurrencyCode`
      // stamped yet fall back to COUNTRY_CURRENCY_MAP — otherwise the amount
      // lands as raw ₳ in a local-denominated liquidCapital field.
      const code = corp ? resolveCorpLiquidCurrencyCode(corp) : undefined;
      // USD floats against ₳ like every other forex-active currency — must use
      // the live rate, not 1.0. See invariant in corporationCapital.ts:13-17.
      const rate = code ? (fxByCurrency.get(code) ?? 1.0) : 1.0;
      const credit = anchorToCorpCapital(amount, code, rate);
      return {
        updateOne: {
          filter: { _id: new ObjectId(corpIdStr) },
          update: { $inc: { liquidCapital: credit }, $set: { updatedAt: now } },
        },
      };
    });
    await db.collection("corporations").bulkWrite(corpPayOps);
  }

  // Legacy fallback for worlds without a currency pool.
  if (corpTreasuryDeltas.size > 0) {
    const treasuryOps = [...corpTreasuryDeltas.entries()]
      .filter(([, delta]) => delta !== 0)
      .map(([corpIdStr, delta]) => ({
        updateOne: {
          filter: { _id: new ObjectId(corpIdStr) },
          update: { $inc: { liquidCapital: delta }, $set: { updatedAt: now } },
        },
      }));
    if (treasuryOps.length > 0) {
      await db.collection("corporations").bulkWrite(treasuryOps);
    }
  }

  // ── Index-fund buy fills ─────────────────────────────────────────────────
  // Credit fund cap-table holdings for each (corp, fund) buy fill, then refund
  // unused escrow to each fund's cashAnchor. Float deltas were already applied
  // above (corpFloatDeltas), so pass shares-only credits here (no extra float
  // $inc because that would double-decrement). Pool-backed fills have already posted
  // the matching buyer cash leg above.
  if (fundShareholderUpdates.size > 0) {
    const fundIds = [
      ...new Set(
        [...fundShareholderUpdates.values()].flatMap((fundDeltas) => [...fundDeltas.keys()])
      ),
    ];
    const funds = await db
      .collection<IndexFund>("indexFunds")
      .find({ _id: { $in: fundIds.map((id) => new ObjectId(id)) } })
      .project<Pick<IndexFund, "_id" | "holdings">>({ _id: 1, holdings: 1 })
      .toArray();
    const fundMap = new Map(funds.map((fund) => [fund._id.toString(), fund]));
    const fundCapTableOps: {
      updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> };
    }[] = [];
    const fundHoldingOps: {
      updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> };
    }[] = [];
    for (const [corpIdStr, fundDeltas] of fundShareholderUpdates) {
      const corp = corpMap.get(corpIdStr);
      if (!corp) continue;
      const targetFxRate = fxRateForCorpFromMap(corp, fxByCurrency);
      for (const [fundIdStr, { delta, pricePerShare }] of fundDeltas) {
        if (delta <= 0) continue;
        // Stamp ₳ cost basis on the fund holding (pricePerShare is corp-local).
        const fillPriceAnchor = corpLiquidCapitalToAnchor(pricePerShare ?? 0, corp, targetFxRate);
        const fundId = new ObjectId(fundIdStr);
        const existing = corp.shareholders?.find(
          (shareholder) => shareholder.fundId?.toString() === fundIdStr
        );
        if (existing) {
          const existingShares = existing.shares ?? 0;
          const oldAvg = existing.avgCostPerShare ?? fillPriceAnchor;
          const avgCostPerShare =
            existingShares > 0
              ? (existingShares * oldAvg + delta * fillPriceAnchor) / (existingShares + delta)
              : fillPriceAnchor;
          fundCapTableOps.push({
            updateOne: {
              filter: { _id: new ObjectId(corpIdStr), "shareholders.fundId": fundId },
              update: {
                $inc: { "shareholders.$.shares": delta },
                $set: { "shareholders.$.avgCostPerShare": avgCostPerShare, updatedAt: now },
              },
            },
          });
        } else {
          fundCapTableOps.push({
            updateOne: {
              filter: { _id: new ObjectId(corpIdStr) },
              update: {
                $push: {
                  shareholders: { fundId, shares: delta, avgCostPerShare: fillPriceAnchor },
                },
                $set: { updatedAt: now },
              },
            },
          });
        }
        const holding = fundMap
          .get(fundIdStr)
          ?.holdings?.find((item) => item.corporationId.toString() === corpIdStr);
        if (holding) {
          const newShares = holding.shares + delta;
          const avgCostPerShareAnchor =
            holding.avgCostPerShareAnchor !== undefined
              ? (holding.shares * holding.avgCostPerShareAnchor + delta * fillPriceAnchor) /
                newShares
              : fillPriceAnchor;
          fundHoldingOps.push({
            updateOne: {
              filter: {
                _id: fundId,
                "holdings.corporationId": new ObjectId(corpIdStr),
              },
              update: {
                $inc: { "holdings.$.shares": delta },
                $set: {
                  "holdings.$.avgCostPerShareAnchor": avgCostPerShareAnchor,
                  "holdings.$.lastValueAnchor": newShares * fillPriceAnchor,
                  updatedAt: now,
                },
              },
            },
          });
        } else {
          fundHoldingOps.push({
            updateOne: {
              filter: { _id: fundId },
              update: {
                $push: {
                  holdings: {
                    corporationId: new ObjectId(corpIdStr),
                    shares: delta,
                    avgCostPerShareAnchor: fillPriceAnchor,
                    lastValueAnchor: delta * fillPriceAnchor,
                  },
                },
                $set: { updatedAt: now },
              },
            },
          });
        }
      }
    }
    if (fundCapTableOps.length > 0) {
      await db.collection("corporations").bulkWrite(fundCapTableOps);
    }
    if (fundHoldingOps.length > 0) {
      await db.collection("indexFunds").bulkWrite(fundHoldingOps);
    }
  }

  if (fundCashAdjustments.size > 0) {
    const fundRefundOps = [...fundCashAdjustments.entries()]
      .filter(([, amount]) => amount > 0)
      .map(([fundIdStr, amount]) => ({
        updateOne: {
          filter: { _id: new ObjectId(fundIdStr) },
          update: { $inc: { cashAnchor: amount }, $set: { updatedAt: now } },
        },
      }));
    if (fundRefundOps.length > 0) {
      await db.collection("indexFunds").bulkWrite(fundRefundOps);
    }
    // #992 tranche 4: one aggregate stock_order_refund row per fund for the
    // unused-escrow refunds just credited above (partial fills execute below
    // the limit price). Aggregated per fund because the map already nets every
    // fill in this pass; the placement escrow rows (stock_order_escrow, same
    // order_escrow reason) net against these per currency. One batched fund
    // read supplies the currency map — no per-fund round trip. A fund with no
    // doc moves no cash and emits nothing.
    const refundedFundIds = [...fundCashAdjustments.entries()]
      .filter(([, amount]) => amount > 0)
      .map(([fundIdStr]) => fundIdStr);
    if (refundedFundIds.length > 0) {
      const refundedFunds = await db
        .collection<IndexFund>("indexFunds")
        .find({ _id: { $in: refundedFundIds.map((id) => new ObjectId(id)) } })
        .project<{ _id: ObjectId; name: string; anchorCurrencyCode: string }>({
          _id: 1,
          name: 1,
          anchorCurrencyCode: 1,
        })
        .toArray();
      const fundById = new Map(refundedFunds.map((f) => [f._id.toString(), f]));
      const thresholds = await loadTxThresholds(db);
      await emitTxBulk(
        db,
        refundedFundIds.flatMap((fundIdStr) => {
          const fund = fundById.get(fundIdStr);
          const amount = fundCashAdjustments.get(fundIdStr) ?? 0;
          if (!fund || !(amount > 0)) return [];
          return [
            {
              type: "stock_order_refund" as const,
              turn,
              createdAt: now,
              subjectType: "fund" as const,
              subjectId: new ObjectId(fundIdStr),
              subjectName: fund.name,
              amount,
              anchorAmount: amount,
              currencyCode: fund.anchorCurrencyCode as IndexFund["anchorCurrencyCode"],
              counterpartyType: "system" as const,
              counterpartyName: "Order book escrow",
              meta: {
                source: "turn-fill-partial-refund",
                escrowAmountAnchor: amount,
              },
            },
          ];
        }),
        thresholds
      );
    }
  }

  // Resolve party display names in a batch and emit history rows. Trade-history
  // writes are best-effort; they must not roll back any share movement above.
  if (historyEmits.length > 0) {
    const charIdSet = new Set<string>();
    const corpIdSet = new Set<string>();
    for (const emit of historyEmits) {
      if (emit.fromPartyRef?.characterId) charIdSet.add(emit.fromPartyRef.characterId.toString());
      if (emit.toPartyRef?.characterId) charIdSet.add(emit.toPartyRef.characterId.toString());
      if (emit.fromPartyRef?.corporationId)
        corpIdSet.add(emit.fromPartyRef.corporationId.toString());
      if (emit.toPartyRef?.corporationId) corpIdSet.add(emit.toPartyRef.corporationId.toString());
    }

    const [nameChars, nameCorps] = await Promise.all([
      charIdSet.size > 0
        ? db
            .collection<Character>("characters")
            .find({ _id: { $in: [...charIdSet].map((id) => new ObjectId(id)) } })
            .project<{ _id: ObjectId; name: string }>({ _id: 1, name: 1 })
            .toArray()
        : Promise.resolve([] as { _id: ObjectId; name: string }[]),
      corpIdSet.size > 0
        ? db
            .collection<Corporation>("corporations")
            .find({ _id: { $in: [...corpIdSet].map((id) => new ObjectId(id)) } })
            .project<{ _id: ObjectId; name: string }>({ _id: 1, name: 1 })
            .toArray()
        : Promise.resolve([] as { _id: ObjectId; name: string }[]),
    ]);
    const charNameMap = new Map(nameChars.map((c) => [c._id.toString(), c.name]));
    const corpNameMap = new Map(nameCorps.map((c) => [c._id.toString(), c.name]));

    const toParty = (
      ref: PendingHistoryEmit["fromPartyRef"] | PendingHistoryEmit["toPartyRef"]
    ): ShareTradeParty | null => {
      if (!ref) return null;
      if (ref.characterId) {
        return {
          characterId: ref.characterId,
          name: charNameMap.get(ref.characterId.toString()) ?? "Unknown character",
        };
      }
      if (ref.corporationId) {
        return {
          corporationId: ref.corporationId,
          name: corpNameMap.get(ref.corporationId.toString()) ?? "Unknown corporation",
        };
      }
      return null;
    };

    await recordShareTrades(
      db,
      historyEmits.map((emit) => ({
        corporationId: emit.corporationId,
        kind: emit.kind,
        turn,
        shares: emit.shares,
        pricePerShareAnchor: emit.pricePerShareAnchor,
        corpCurrencyCode: emit.corpCurrencyCode,
        from: toParty(emit.fromPartyRef),
        to: toParty(emit.toPartyRef),
      }))
    );
  }
}
