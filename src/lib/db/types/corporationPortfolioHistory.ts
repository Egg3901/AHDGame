import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * Per-corporation portfolio value snapshot taken each turn.
 * Tracks gross assets, liabilities, and debt-adjusted net worth for corporations.
 */
export interface CorporationPortfolioHistory {
  _id: ObjectId;
  corporationId: ObjectId;
  turn: number;
  /** Gross assets in anchor units (stocks + bonds held + liquid capital). */
  totalValue: number;
  /** Debt-adjusted net worth in anchor units (gross assets - liabilities). */
  netValue?: number;
  /** Stock holdings value (shares × sharePrice, anchor-normalized). */
  stockValue?: number;
  /** Bond holdings value (units × faceValue × marketPrice, anchor-normalized). */
  bondValue?: number;
  /** Liquid capital at snapshot time (anchor-normalized). */
  cashValue?: number;
  /** Issued bond principal + IMF facility principal outstanding, anchor-normalized. */
  liabilityValue?: number;
  /**
   * FX rates (local per 1 ₳) at snapshot time, keyed by currency code. See
   * {@link import("./portfolioHistory").PortfolioHistory.exchangeRatesSnapshot}
   * — same purpose: lets the corp portfolio chart re-anchor each historical
   * point at its own snapshot-time rate instead of today's rate.
   */
  exchangeRatesSnapshot?: Partial<Record<CurrencyCode, number>>;
  createdAt: Date;
}
