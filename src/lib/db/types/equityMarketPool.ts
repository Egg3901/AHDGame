import type { CurrencyCode } from "@/lib/constants/currencies";

export const EQUITY_MARKET_POOLS_COLLECTION = "equityMarketPools";

/**
 * Auditable cash-flow counters for the cash side of the equity public float.
 * `In` raises pool cash and `Out` lowers it.
 */
export type EquityMarketPoolFlowKind =
  "purchasesIn" | "salesOut" | "dividendsIn" | "issuanceOut" | "inflowIn" | "sweepOut";

/**
 * The real counterparty behind every corporation's `publicFloat`.
 *
 * A corporation keeps the inventory count on its own document. One pool per
 * currency keeps the other side of that balance sheet: local-currency cash.
 * Market buys pay the pool; market sells are limited to what it can pay.
 */
export interface EquityMarketPool {
  _id: CurrencyCode;
  cashLocal: number;
  targetCashLocal: number;
  m2Local?: number;
  /**
   * Cash the pool was created with, in local currency.
   *
   * Pools were originally inserted at `m2 x EQUITY_POOL_M2_SHARE` with no ledger
   * counter, so without this the conservation identity cannot be evaluated at
   * all: there is no way to tell an opening balance from created money.
   * Backfilled by 2026-09-07-equity-pool-seed-backfill; absent on a pool that
   * predates it, which `poolConservationResidual` reports as NaN.
   */
  seedLocal?: number;
  lastTurn?: number;
  lifetime: Partial<Record<EquityMarketPoolFlowKind, number>>;
  createdAt: Date;
  updatedAt: Date;
}
