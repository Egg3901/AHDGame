/**
 * Forex activity evidence for qualification runs (issue #2293).
 *
 * An enabled forex phase moves rates from macro drift, volume pressure and
 * central-bank intervention. Pure-NPP worlds have no character wallets, so the
 * order book stays empty and every rate move is macro-only. This rule turns raw
 * order, trade and intervention counts into one record that says so, so an
 * enabled but unexercised product is never read as a qualified market.
 *
 * Pure: plain data in, plain data out.
 */

export interface ForexOrderRow {
  status: "open" | "processing" | "filled" | "partial" | "cancelled" | "expired";
  amount: number;
  filledAmount: number;
}

export interface ForexTradeRow {
  /** Amount in the trade's from-currency. */
  amount: number;
  /** Execution rate; used to normalize the volume into internal units. */
  rate: number;
  spread: number;
}

export interface ForexActivityInput {
  forexEnabled: boolean;
  orders: readonly ForexOrderRow[];
  trades: readonly ForexTradeRow[];
  /** Intervention records retained across all currencies. */
  interventionCount: number;
}

export type ForexRateAttribution = "disabled" | "macro_only" | "market_activity";

export interface ForexActivityRecord {
  forexEnabled: boolean;
  orderCount: number;
  filledOrderCount: number;
  /** Orders still open, processing or partially filled at the end of the run. */
  unresolvedOrderCount: number;
  /** Filled or partial orders over all orders; null when there are none. */
  fillRate: number | null;
  tradeCount: number;
  /** Executed volume in internal units (amount / rate per trade). */
  executedVolume: number;
  /** Total spread charged over executed from-currency amount; null at zero volume. */
  spreadRate: number | null;
  interventionCount: number;
  /**
   * What the run may say moved the exchange rates. `market_activity` only when
   * executed volume is positive; zero volume means the drift is macro-driven
   * (plus any intervention) and must not be attributed to trading.
   */
  rateAttribution: ForexRateAttribution;
  exercised: boolean;
  /** One report line; a warning when enabled but unexercised. */
  summary: string;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function summarizeForexActivity(input: ForexActivityInput): ForexActivityRecord {
  const orderCount = input.orders.length;
  let filledOrderCount = 0;
  let unresolvedOrderCount = 0;
  let touched = 0;
  for (const order of input.orders) {
    if (order.status === "filled") filledOrderCount += 1;
    if (order.status === "open" || order.status === "processing" || order.status === "partial") {
      unresolvedOrderCount += 1;
    }
    if (order.status === "filled" || order.status === "partial" || finite(order.filledAmount) > 0) {
      touched += 1;
    }
  }

  let executedVolume = 0;
  let fromAmount = 0;
  let spread = 0;
  for (const trade of input.trades) {
    const amount = Math.max(0, finite(trade.amount));
    const rate = finite(trade.rate);
    if (amount > 0 && rate > 0) executedVolume += amount / rate;
    fromAmount += amount;
    spread += Math.max(0, finite(trade.spread));
  }

  const tradeCount = input.trades.length;
  const interventionCount = Math.max(0, Math.floor(finite(input.interventionCount)));
  const rateAttribution: ForexRateAttribution = !input.forexEnabled
    ? "disabled"
    : executedVolume > 0
      ? "market_activity"
      : "macro_only";
  const exercised = input.forexEnabled && executedVolume > 0;
  const fillRate = orderCount > 0 ? touched / orderCount : null;
  const spreadRate = fromAmount > 0 ? spread / fromAmount : null;

  const summary = !input.forexEnabled
    ? "Forex disabled: no orders, trades or rate attribution expected."
    : exercised
      ? `Forex exercised: ${orderCount} orders, ${tradeCount} trades, ` +
        `${filledOrderCount} filled, ${unresolvedOrderCount} unresolved, ` +
        `${interventionCount} interventions.`
      : `Forex enabled but UNEXERCISED: ${orderCount} orders, ${tradeCount} trades, ` +
        `${interventionCount} interventions. Rate movement is macro-only and is not ` +
        "evidence of market liquidity, spread or settlement.";

  return {
    forexEnabled: input.forexEnabled,
    orderCount,
    filledOrderCount,
    unresolvedOrderCount,
    fillRate,
    tradeCount,
    executedVolume,
    spreadRate,
    interventionCount,
    rateAttribution,
    exercised,
    summary,
  };
}
