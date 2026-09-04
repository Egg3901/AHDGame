/** Per-turn sizing and savings flow for finite equity market pools. */

import type { Db } from "mongodb";
import type { EquityMarketPool } from "@/lib/db/types";
import { EQUITY_MARKET_POOLS_COLLECTION } from "@/lib/db/types/equityMarketPool";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { creditEquityPool, debitEquityPoolGated, EQUITY_POOL_M2_SHARE } from "./marketPool";

export const EQUITY_POOL_INFLOW_RATE = 0.02;
export const EQUITY_POOL_SWEEP_TRIGGER_MULTIPLE = 2;
export const EQUITY_POOL_SWEEP_TO_MULTIPLE = 1.5;

export function planEquityPoolCashMove(input: { cashLocal: number; targetCashLocal: number }): {
  inflow: number;
  sweep: number;
} {
  const target = Number.isFinite(input.targetCashLocal) ? Math.max(0, input.targetCashLocal) : 0;
  const cash = Number.isFinite(input.cashLocal) ? Math.max(0, input.cashLocal) : 0;
  if (target <= 0) return { inflow: 0, sweep: 0 };
  if (cash < target) {
    return {
      inflow: Math.round((target - cash) * EQUITY_POOL_INFLOW_RATE * 100) / 100,
      sweep: 0,
    };
  }
  if (cash > target * EQUITY_POOL_SWEEP_TRIGGER_MULTIPLE) {
    return {
      inflow: 0,
      sweep: Math.round((cash - target * EQUITY_POOL_SWEEP_TO_MULTIPLE) * 100) / 100,
    };
  }
  return { inflow: 0, sweep: 0 };
}

export async function processEquityMarketPoolTurn(
  db: Db,
  turn: number,
  now: Date
): Promise<{
  poolsProcessed: number;
  activeCurrencies: CurrencyCode[];
  inflowLocalByCurrency: Record<string, number>;
  sweptLocalByCurrency: Record<string, number>;
}> {
  const pools = await db
    .collection<EquityMarketPool>(EQUITY_MARKET_POOLS_COLLECTION)
    .find({})
    .toArray();
  const result = {
    poolsProcessed: 0,
    activeCurrencies: pools.map((pool) => pool._id),
    inflowLocalByCurrency: {} as Record<string, number>,
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
    if (move.inflow > 0) {
      await creditEquityPool(db, pool._id, move.inflow, "inflowIn", now);
      result.inflowLocalByCurrency[pool._id] = move.inflow;
    } else if (move.sweep > 0) {
      const debit = await debitEquityPoolGated(db, pool._id, move.sweep, "sweepOut", now);
      if (debit.ok) result.sweptLocalByCurrency[pool._id] = move.sweep;
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
