import type { CurrencyCode } from "@/lib/constants/currencies";

export const BOND_MARKET_POOLS_COLLECTION = "bondMarketPools";

/**
 * Lifetime flow counters on a pool, one per direction a unit of cash can
 * travel. `In` flows raise `cashLocal`, `Out` flows lower it. They exist so the
 * audit script can reconcile a pool's cash against the sum of its flows
 * without replaying the financial ledger.
 */
export type BondMarketPoolFlowKind =
  | "purchasesIn"
  | "salesOut"
  | "couponsIn"
  | "maturitiesIn"
  | "issuanceOut"
  | "qeIn"
  | "qtOut"
  | "retiredIn"
  | "estateOut"
  | "recoveriesIn";

/**
 * The counterparty for every bond trade that used to hit an infinite "AI
 * market maker". One pool per currency. `publicFloat` on a bond is the number
 * of units this pool holds of that issue; this document is the cash side of
 * the same balance sheet.
 *
 * Cash is in the pool's own currency (LOCAL, never anchor). A buy from the
 * float credits `cashLocal`; a sale to the float debits it and is refused when
 * the pool cannot pay, which is what makes secondary liquidity finite. Coupons
 * and maturity face value on pool-held units are paid into the pool by the
 * issuer, so returns feed the pool.
 */
export interface BondMarketPool {
  _id: CurrencyCode;
  cashLocal: number;
  /**
   * Where the pool's cash is steered toward over time. Seeded from a share of
   * the currency's broad money on migration; the turn engine nudges cash
   * toward it (phase 2) so a pool neither drains to zero nor hoards without
   * bound.
   */
  targetCashLocal: number;
  lastTurn?: number;
  lifetime: Partial<Record<BondMarketPoolFlowKind, number>>;
  createdAt: Date;
  updatedAt: Date;
}
