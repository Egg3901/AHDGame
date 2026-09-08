/** Per-turn sizing and savings flow for finite equity market pools. */

import type { Db } from "mongodb";
import type { EquityMarketPool } from "@/lib/db/types";
import { EQUITY_MARKET_POOLS_COLLECTION } from "@/lib/db/types/equityMarketPool";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { debitEquityPoolGated, EQUITY_POOL_M2_SHARE } from "./marketPool";
import { poolConservationResidual } from "./poolConservation";

export const EQUITY_POOL_SWEEP_TRIGGER_MULTIPLE = 2;
export const EQUITY_POOL_SWEEP_TO_MULTIPLE = 1.5;

/**
 * Per-turn cash move for an equity market pool. SWEEP ONLY.
 *
 * ─── WHY THE INFLOW IS GONE ─────────────────────────────────────────────────
 * This used to credit `(target - cash) x EQUITY_POOL_INFLOW_RATE` (2%) whenever
 * a pool sat below its M2-derived target. That credit had no funding source and
 * no counterparty: it was money creation, and because it was conditional on
 * `cash < target` it re-armed every time players drained a pool by selling into
 * it. By turn 695 the USD pool had minted 21.99B against 3.77B of real player
 * purchases — 5.8x — and was still minting ~230.5M per turn. It was the
 * mechanism that converted an inflated share price into spendable cash.
 *
 * A pool is now strictly a finite book: it can pay out only what it was seeded
 * with plus what it actually took in. Nothing else changes, because the refusal
 * path already existed — `debitEquityPoolGated` matches on
 * `cashLocal >= amount` and returns `{ ok: false }`, and `settleFloatSellDebit`
 * already propagates that to a player-facing "use the peer order book" message.
 *
 * The SWEEP is retained. Removing excess cash is a sink, not a mint, and it is
 * ledgered as `sweepOut`, so `poolConservationResidual` still balances.
 */
export function planEquityPoolCashMove(input: { cashLocal: number; targetCashLocal: number }): {
  sweep: number;
} {
  const target = Number.isFinite(input.targetCashLocal) ? Math.max(0, input.targetCashLocal) : 0;
  const cash = Number.isFinite(input.cashLocal) ? Math.max(0, input.cashLocal) : 0;
  if (target <= 0) return { sweep: 0 };
  if (cash > target * EQUITY_POOL_SWEEP_TRIGGER_MULTIPLE) {
    return {
      sweep: Math.round((cash - target * EQUITY_POOL_SWEEP_TO_MULTIPLE) * 100) / 100,
    };
  }
  return { sweep: 0 };
}

export async function processEquityMarketPoolTurn(
  db: Db,
  turn: number,
  now: Date
): Promise<{
  poolsProcessed: number;
  activeCurrencies: CurrencyCode[];
  sweptLocalByCurrency: Record<string, number>;
}> {
  const pools = await db
    .collection<EquityMarketPool>(EQUITY_MARKET_POOLS_COLLECTION)
    .find({})
    .toArray();
  const result = {
    poolsProcessed: 0,
    activeCurrencies: pools.map((pool) => pool._id),
    sweptLocalByCurrency: {} as Record<string, number>,
  };
  for (const pool of pools) {
    const latest = await db
      .collection<{ currencyCode: string; m2?: number; turn: number }>("moneySupplySnapshots")
      .find({ currencyCode: pool._id }, { projection: { m2: 1 }, sort: { turn: -1 }, limit: 1 })
      .toArray();
    const m2 = latest[0]?.m2;
    const targetCashLocal =
      Number.isFinite(m2) && m2! > 0
        ? Math.round(m2! * EQUITY_POOL_M2_SHARE * 100) / 100
        : Math.max(0, pool.targetCashLocal ?? 0);
    const move = planEquityPoolCashMove({ cashLocal: pool.cashLocal, targetCashLocal });
    if (move.sweep > 0) {
      const debit = await debitEquityPoolGated(db, pool._id, move.sweep, "sweepOut", now);
      if (debit.ok) result.sweptLocalByCurrency[pool._id] = move.sweep;
    }

    // A pool that has never been backfilled reports NaN, which is "cannot
    // evaluate", not "breached". Warn rather than throw: this runs inside the
    // hourly turn processor, and aborting every player's turn over an
    // accounting discrepancy in one currency trades a reporting problem for a
    // stranded turn lock.
    const residual = poolConservationResidual(pool);
    if (Number.isFinite(residual) && residual > 1) {
      console.warn(
        `[equityPool] conservation breach on ${pool._id}: holds ${residual.toFixed(2)} ` +
          `more than seed + inflows - outflows`
      );
    }
    await db.collection<EquityMarketPool>(EQUITY_MARKET_POOLS_COLLECTION).updateOne(
      { _id: pool._id },
      {
        $set: {
          targetCashLocal,
          lastTurn: turn,
          updatedAt: now,
          ...(Number.isFinite(m2) && m2! > 0 ? { m2Local: m2 } : {}),
        },
      }
    );
    result.poolsProcessed++;
  }
  return result;
}
