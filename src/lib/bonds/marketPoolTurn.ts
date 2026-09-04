/**
 * Per-turn upkeep for the bond market pools.
 *
 * 1. Re-size each pool's target to a share of its currency's latest broad
 *    money, so the pool scales with the economy it sits in.
 * 2. Let savings flow in toward the target when the pool is short, and sweep
 *    cash back out to depositors when it has hoarded far past the target.
 *    Inflow is the institutional deposit base growing; it is new money to the
 *    pool and is counted in M2 through `bondPoolCash`. The sweep is the same
 *    money leaving.
 * 3. Refresh the pool's appetite for each sovereign issuer in its currency
 *    from the sovereign-default demand model, so quotes on a CCC sovereign at
 *    four times GDP are thinner than on an AAA one.
 *
 * Runs at the top of the bond turn, before any coupon or trade.
 */

import type { Db } from "mongodb";
import type { BondMarketPool } from "@/lib/db/types";
import { BOND_MARKET_POOLS_COLLECTION } from "@/lib/db/types/bondMarketPool";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { BOND_POOL_M2_SHARE, creditBondPool, debitBondPoolGated } from "@/lib/bonds/marketPool";
import { loadCountrySovereignSnapshot } from "@/lib/sovereignDefault/snapshotLoader";
import { computeMarketDemand } from "@/lib/sovereignDefault/marketDemand";
import { SOVEREIGN_ISSUANCE_INTERVAL_TURNS } from "@/lib/bonds/sovereign";

/** Share of the shortfall against target that flows in per turn. */
export const BOND_POOL_INFLOW_RATE = 0.02;
/** Cash above this multiple of target triggers a sweep... */
export const BOND_POOL_SWEEP_TRIGGER_MULTIPLE = 2;
/** ...down to this multiple. */
export const BOND_POOL_SWEEP_TO_MULTIPLE = 1.5;

export interface BondMarketPoolTurnResult {
  poolsProcessed: number;
  inflowLocalByCurrency: Record<string, number>;
  sweptLocalByCurrency: Record<string, number>;
  appetitesRefreshed: number;
}

export function planPoolCashMoves(input: { cashLocal: number; targetCashLocal: number }): {
  inflow: number;
  sweep: number;
} {
  const target =
    Number.isFinite(input.targetCashLocal) && input.targetCashLocal > 0 ? input.targetCashLocal : 0;
  const cash = Number.isFinite(input.cashLocal) && input.cashLocal > 0 ? input.cashLocal : 0;
  if (target <= 0) return { inflow: 0, sweep: 0 };
  if (cash < target) {
    return { inflow: Math.round((target - cash) * BOND_POOL_INFLOW_RATE * 100) / 100, sweep: 0 };
  }
  if (cash > target * BOND_POOL_SWEEP_TRIGGER_MULTIPLE) {
    return {
      inflow: 0,
      sweep: Math.round((cash - target * BOND_POOL_SWEEP_TO_MULTIPLE) * 100) / 100,
    };
  }
  return { inflow: 0, sweep: 0 };
}

export function countriesForCurrency(currency: CurrencyCode): CountryId[] {
  return (Object.entries(COUNTRY_CURRENCY_MAP) as Array<[CountryId, CurrencyCode]>)
    .filter(([, code]) => code === currency)
    .map(([countryId]) => countryId);
}

/** Face of live sovereign paper in `currency` maturing within the next issuance interval. */
export async function sovereignFaceMaturingSoon(
  db: Db,
  currency: CurrencyCode,
  turn: number
): Promise<number> {
  const rows = await db
    .collection<{ totalIssued?: number }>("bonds")
    .find(
      {
        issuerType: "sovereign",
        currencyCode: currency,
        matured: false,
        defaulted: false,
        maturityTurn: { $gte: turn, $lt: turn + SOVEREIGN_ISSUANCE_INTERVAL_TURNS },
      },
      { projection: { totalIssued: 1 } }
    )
    .toArray();
  return rows.reduce((sum, row) => sum + Math.max(0, row.totalIssued ?? 0), 0);
}

export async function processBondMarketPoolTurn(
  db: Db,
  turn: number,
  now: Date
): Promise<BondMarketPoolTurnResult> {
  const pools = await db
    .collection<BondMarketPool>(BOND_MARKET_POOLS_COLLECTION)
    .find({})
    .toArray();
  const result: BondMarketPoolTurnResult = {
    poolsProcessed: 0,
    inflowLocalByCurrency: {},
    sweptLocalByCurrency: {},
    appetitesRefreshed: 0,
  };
  if (pools.length === 0) return result;

  for (const pool of pools) {
    const currency = pool._id;
    const latest = await db
      .collection<{ currencyCode: string; m2?: number; turn: number }>("moneySupplySnapshots")
      .find(
        { currencyCode: currency },
        { projection: { m2: 1, turn: 1 }, sort: { turn: -1 }, limit: 1 }
      )
      .toArray();
    const m2 = latest[0]?.m2;
    // Working balance: the pool re-buys every quarter's rollover before the
    // maturing series pays it back, so it must hold one quarter of maturing
    // sovereign face on top of its secondary-liquidity share of M2.
    const rolloverLocal = await sovereignFaceMaturingSoon(db, currency, turn);
    const liquidityTarget =
      Number.isFinite(m2) && m2! > 0 ? m2! * BOND_POOL_M2_SHARE : pool.targetCashLocal;
    const targetCashLocal = Math.round(Math.max(liquidityTarget, rolloverLocal) * 100) / 100;

    const moves = planPoolCashMoves({ cashLocal: pool.cashLocal, targetCashLocal });
    if (moves.inflow > 0) {
      await creditBondPool(db, currency, moves.inflow, "inflowIn", now);
      result.inflowLocalByCurrency[currency] = moves.inflow;
    } else if (moves.sweep > 0) {
      const debit = await debitBondPoolGated(db, currency, moves.sweep, "sweepOut", now);
      if (debit.ok) result.sweptLocalByCurrency[currency] = moves.sweep;
    }

    const appetiteByCountry: Partial<Record<CountryId, number>> = {};
    for (const countryId of countriesForCurrency(currency)) {
      const snapshot = await loadCountrySovereignSnapshot(db, countryId, turn);
      if (!snapshot) continue;
      const demand = computeMarketDemand(snapshot);
      if (Number.isFinite(demand.demandRatio)) {
        appetiteByCountry[countryId] = Math.round(demand.demandRatio * 1000) / 1000;
        result.appetitesRefreshed++;
      }
    }

    await db.collection<BondMarketPool>(BOND_MARKET_POOLS_COLLECTION).updateOne(
      { _id: currency },
      {
        $set: {
          targetCashLocal,
          appetiteByCountry,
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
