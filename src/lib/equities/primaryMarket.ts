/** Primary equity underwriting and paced placement of approved unsold shares. */

import type { Db } from "mongodb";
import type { Corporation, EquityMarketPool } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { EQUITY_MARKET_POOLS_COLLECTION } from "@/lib/db/types/equityMarketPool";
import { issuanceDilutionFactorExpr } from "@/lib/corporations/shareConsolidation";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import { corpLiquidCapitalToAnchor, getCorpFxRate } from "@/lib/currency/corporationCapital";
import { emitTx } from "@/lib/financialTxLog/emit";
import {
  debitEquityPoolGated,
  equityPoolCurrency,
  EQUITY_POOL_M2_SHARE,
  loadEquityQuote,
  readEquityPool,
  refundEquityPoolDebit,
} from "./marketPool";

/** Maximum share of the pool's equity-liquidity allocation committed to one issue. */
export const EQUITY_PRIMARY_COMMIT_SHARE = 0.2;
/** Portion of an approved issue that may be placed on any later turn. */
export const EQUITY_PENDING_PLACEMENT_SHARE_PER_TURN = 0.02;
/** Portion of spendable pool cash available to all pending placements each turn. */
export const EQUITY_PENDING_CASH_SHARE_PER_TURN = 0.1;
/** Preserve half the target as secondary-market bid depth. */
export const EQUITY_PENDING_RESERVE_SHARE = 0.5;

function wholeShares(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function planEquityUnderwriting(input: {
  requestedShares: number;
  poolCashLocal: number;
  poolM2Local?: number;
  pricePerShareLocal: number;
}): { placedShares: number; unsoldShares: number; capacityLocal: number; fillRatio: number } {
  const requested = wholeShares(input.requestedShares);
  const cash = Math.max(0, input.poolCashLocal);
  const liquidityCash = Math.min(
    cash,
    input.poolM2Local && input.poolM2Local > 0 ? input.poolM2Local * EQUITY_POOL_M2_SHARE : cash
  );
  const capacityLocal = liquidityCash * EQUITY_PRIMARY_COMMIT_SHARE;
  const capacityShares =
    input.pricePerShareLocal > 0 ? Math.floor(capacityLocal / input.pricePerShareLocal) : 0;
  const placedShares = Math.min(requested, Math.max(0, capacityShares));
  return {
    placedShares,
    unsoldShares: requested - placedShares,
    capacityLocal,
    fillRatio: requested > 0 ? placedShares / requested : 1,
  };
}

export function pendingEquityPlacementBudget(cashLocal: number, targetCashLocal: number): number {
  const cash = Math.max(0, Number.isFinite(cashLocal) ? cashLocal : 0);
  const target = Math.max(0, Number.isFinite(targetCashLocal) ? targetCashLocal : 0);
  return (
    Math.max(0, cash - target * EQUITY_PENDING_RESERVE_SHARE) * EQUITY_PENDING_CASH_SHARE_PER_TURN
  );
}

export interface PreparedEquityPlacement {
  poolActive: boolean;
  currency: CurrencyCode;
  requestedShares: number;
  placedShares: number;
  unsoldShares: number;
  paidLocal: number;
}

/** Reserve real pool cash before a caller atomically creates primary float. */
export async function prepareEquityPrimaryPlacement(
  db: Db,
  corporation: Pick<Corporation, "countryId" | "liquidCurrencyCode">,
  requestedShares: number,
  pricePerShareLocal: number,
  now: Date
): Promise<PreparedEquityPlacement> {
  const requested = wholeShares(requestedShares);
  const currency = equityPoolCurrency(corporation);
  const pool = await readEquityPool(db, currency);
  if (!pool) {
    return {
      poolActive: false,
      currency,
      requestedShares: requested,
      placedShares: requested,
      unsoldShares: 0,
      paidLocal: 0,
    };
  }
  const plan = planEquityUnderwriting({
    requestedShares: requested,
    poolCashLocal: pool.cashLocal,
    poolM2Local: pool.m2Local,
    pricePerShareLocal,
  });
  if (plan.placedShares <= 0) {
    return {
      poolActive: true,
      currency,
      requestedShares: requested,
      placedShares: 0,
      unsoldShares: requested,
      paidLocal: 0,
    };
  }
  const wanted = Math.round(plan.placedShares * pricePerShareLocal * 100) / 100;
  const debit = await debitEquityPoolGated(db, currency, wanted, "issuanceOut", now);
  return {
    poolActive: true,
    currency,
    requestedShares: requested,
    placedShares: debit.ok ? plan.placedShares : 0,
    unsoldShares: debit.ok ? plan.unsoldShares : requested,
    paidLocal: debit.ok ? wanted : 0,
  };
}

export async function refundPreparedEquityPlacement(
  db: Db,
  placement: PreparedEquityPlacement,
  now: Date
): Promise<void> {
  if (!placement.poolActive || placement.paidLocal <= 0) return;
  await refundEquityPoolDebit(db, placement.currency, placement.paidLocal, "issuanceOut", now);
}

/** Place approved unsold equity gradually without consuming the pool's bid reserve. */
export async function placePendingShareIssuances(
  db: Db,
  turn: number,
  now: Date
): Promise<{ corporationsTouched: number; sharesPlaced: number; paidLocal: number }> {
  const corporations = await db
    .collection<Corporation>("corporations")
    .find({ "pendingShareIssuance.remainingShares": { $gt: 0 }, isPrivate: { $ne: true } })
    .sort({ "pendingShareIssuance.createdAtTurn": 1 })
    .toArray();
  const result = { corporationsTouched: 0, sharesPlaced: 0, paidLocal: 0 };
  const budgetByCurrency = new Map<CurrencyCode, number>();

  for (const corporation of corporations) {
    const pending = corporation.pendingShareIssuance;
    if (!pending || pending.remainingShares <= 0) continue;
    const currency = equityPoolCurrency(corporation);
    if (!budgetByCurrency.has(currency)) {
      const pool = await readEquityPool(db, currency);
      budgetByCurrency.set(
        currency,
        pool ? pendingEquityPlacementBudget(pool.cashLocal, pool.targetCashLocal) : 0
      );
    }
    let budget = budgetByCurrency.get(currency) ?? 0;
    if (budget <= 0) continue;
    const quote = await loadEquityQuote(db, corporation);
    // Match the bond pool's unsold-placement rail: deferred primary inventory
    // places at the dealer ask, with the same finite cash and reserve limits.
    const price = quote.askPriceLocal;
    if (!(price > 0)) continue;
    const perTurnCap = Math.max(
      1,
      Math.floor(pending.requestedShares * EQUITY_PENDING_PLACEMENT_SHARE_PER_TURN)
    );
    const shares = Math.min(
      wholeShares(pending.remainingShares),
      perTurnCap,
      Math.floor(budget / price)
    );
    if (shares <= 0) continue;
    const paidLocal = Math.round(shares * price * 100) / 100;
    const debit = await debitEquityPoolGated(db, currency, paidLocal, "issuanceOut", now);
    if (!debit.ok) continue;

    const update = await db.collection<Corporation>("corporations").updateOne(
      {
        _id: corporation._id,
        "pendingShareIssuance.remainingShares": { $gte: shares },
      },
      [
        {
          $set: {
            totalShares: { $add: [{ $ifNull: ["$totalShares", 0] }, shares] },
            publicFloat: { $add: [{ $ifNull: ["$publicFloat", 0] }, shares] },
            liquidCapital: { $add: [{ $ifNull: ["$liquidCapital", 0] }, paidLocal] },
            shareIssuanceProceeds: {
              $add: [{ $ifNull: ["$shareIssuanceProceeds", 0] }, paidLocal],
            },
            sharePrice: {
              $round: [
                {
                  $multiply: [{ $ifNull: ["$sharePrice", 0] }, issuanceDilutionFactorExpr(shares)],
                },
                4,
              ],
            },
            fundamentalSharePrice: {
              $round: [
                {
                  $multiply: [
                    { $ifNull: ["$fundamentalSharePrice", { $ifNull: ["$sharePrice", 0] }] },
                    issuanceDilutionFactorExpr(shares),
                  ],
                },
                4,
              ],
            },
            pendingShareIssuance: {
              $cond: [
                { $lte: ["$pendingShareIssuance.remainingShares", shares] },
                "$$REMOVE",
                {
                  $mergeObjects: [
                    "$pendingShareIssuance",
                    {
                      remainingShares: {
                        $subtract: ["$pendingShareIssuance.remainingShares", shares],
                      },
                    },
                  ],
                },
              ],
            },
            updatedAt: now,
          },
        },
      ]
    );
    if (update.modifiedCount === 0) {
      await refundEquityPoolDebit(db, currency, paidLocal, "issuanceOut", now);
      continue;
    }
    budget -= paidLocal;
    budgetByCurrency.set(currency, budget);
    result.corporationsTouched++;
    result.sharesPlaced += shares;
    result.paidLocal += paidLocal;
    const fxRate = await getCorpFxRate(db, corporation);
    void recordShareTrade(db, {
      corporationId: corporation._id,
      kind: "issuance",
      turn,
      shares,
      pricePerShareAnchor: corpLiquidCapitalToAnchor(price, corporation, fxRate),
      from: null,
      to: null,
      corpCurrencyCode: corporation.liquidCurrencyCode,
      note: `Equity market pool placed ${shares.toLocaleString("en-US")} approved shares`,
    });
    void emitTx(db, {
      type: "ipo_proceeds",
      turn,
      createdAt: now,
      subjectType: "corporation",
      subjectId: corporation._id,
      subjectName: corporation.name,
      amount: paidLocal,
      currencyCode: currency,
      meta: {
        sharesPlaced: shares,
        sharesPending: pending.remainingShares - shares,
        counterparty: "equity_market_pool",
        deferredPlacement: true,
      },
    });
  }
  return result;
}

/** Narrow read used by admin/debug surfaces without exposing Mongo details. */
export async function readEquityPrimaryPool(
  db: Db,
  currency: CurrencyCode
): Promise<Pick<EquityMarketPool, "cashLocal" | "targetCashLocal" | "m2Local"> | null> {
  return db
    .collection<EquityMarketPool>(EQUITY_MARKET_POOLS_COLLECTION)
    .findOne({ _id: currency }, { projection: { cashLocal: 1, targetCashLocal: 1, m2Local: 1 } });
}
