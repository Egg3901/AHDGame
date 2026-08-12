import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * Per-character portfolio value snapshot taken each turn.
 * Created for every character so cash-only and debt-bearing players still
 * have comparable portfolio history.
 */
export interface PortfolioHistory {
  _id: ObjectId;
  characterId: ObjectId;
  turn: number;
  /** Gross assets in anchor units (stocks + bonds + funds + all cash/savings). */
  totalValue: number;
  /** Net worth after subtracting outstanding LOC principal + arrears. */
  netValue?: number;
  /** Stock holdings value (shares × sharePrice) */
  stockValue?: number;
  /** Bond holdings value (units × faceValue × marketPrice) */
  bondValue?: number;
  /**
   * Index-fund holdings value (units × quotedNav) in ₳.
   *
   * Absent on snapshots taken before funds were included: consumers must treat
   * `undefined` as "not measured", not as zero, or a player who has always held
   * funds will appear to have suddenly gained wealth on the turn this shipped.
   */
  fundValue?: number;
  /** Cash + savings combined in anchor units. */
  cashValue?: number;
  /** Liquid personal cash only (internal units), for charts */
  liquidCashValue?: number;
  /** Savings balances only (internal units), for charts */
  savingsCashValue?: number;
  /** Outstanding LOC principal + arrears in anchor units. */
  locDebtValue?: number;
  /**
   * FX rates (local per 1 ₳) at snapshot time, keyed by currency code. Used by
   * portfolio charts to convert each historical point's anchor-denominated
   * values back to local currency at the rate that was actually in effect
   * then — without it, current rates get re-applied to old anchor values and
   * paint phantom volatility (Antonelli/Aurora "missing $6bn" incident).
   * Absent on pre-fix snapshots; consumers must fall back to current rates.
   */
  exchangeRatesSnapshot?: Partial<Record<CurrencyCode, number>>;
  createdAt: Date;
}
