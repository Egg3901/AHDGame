import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * Why the trade was created. Drives the Transaction History UI grouping and
 * lets us distinguish volume originating from explicit player action (which
 * should move rates strongly) from income-flow auto-conversions (which move
 * rates too, but are not a trading decision).
 *
 * Legacy rows (pre-2026-04-15) leave `source` undefined; treat as "manual".
 */
export type TradeSource =
  | "manual" // explicit market-maker trade (Trade form)
  | "direct" // P2P direct-fill (accepting an open offer)
  | "limit_order" // limit order executed (now or during turn processing)
  | "auto_purchase" // auto-convert triggered by share/bond purchase shortfall
  | "auto_dividend" // auto-convert of a dividend credit to player's home currency
  | "auto_coupon" // auto-convert of a bond coupon credit to player's home currency
  | "api"; // trade initiated via user API key

export interface TradeHistoryEntry {
  _id: ObjectId;
  buyerCharacterId: ObjectId;
  /** null = market maker (system-provided liquidity) */
  sellerCharacterId: ObjectId | null;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  /** Amount in fromCurrency */
  amount: number;
  /** Exchange rate at time of execution */
  rate: number;
  /** Spread charged on this trade */
  spread: number;
  turn: number;
  createdAt: Date;
  /** Why the trade happened. Optional for backward compat — legacy rows are "manual". */
  source?: TradeSource;
  /**
   * Optional reference to the originating entity for income-flow conversions.
   * For `auto_dividend`: the paying corporation's ObjectId as a string.
   * For `auto_coupon`: the paying bond's ObjectId as a string.
   * Lets the UI display "Dividend from Sony" / "Coupon from US T-Bill 2.5%".
   */
  sourceRef?: string;
}
