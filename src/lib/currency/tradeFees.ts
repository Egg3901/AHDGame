/**
 * What a player's own currency conversion costs.
 *
 * The base spread (the market maker's or a limit order's, scaled by the source
 * currency chair's spread strength) is joined by a size fee that grows with how
 * much the trader has converted over the volume lookback, and the whole fee is
 * scaled by how busy the two currencies are. A quiet market charges more, a busy
 * one less, and nothing exceeds FOREX_MAX_TRADE_FEE.
 *
 * The size fee is the average of a rising marginal rate over the trader's new
 * slice of volume, so ten trades of ₳1B cost the same as one of ₳10B: splitting
 * a large conversion does not escape it.
 *
 * Pure, so the trade route, the limit-order fill and the trade window's preview
 * all quote the same number.
 */
import {
  FOREX_LIQUIDITY_FEE_MAX,
  FOREX_LIQUIDITY_FEE_MIN,
  FOREX_LIQUIDITY_REFERENCE_VOLUME,
  FOREX_MAX_TRADE_FEE,
  FOREX_SIZE_FEE_HALF_ANCHOR,
  FOREX_SIZE_FEE_MAX,
} from "@/lib/constants/currencies";

/**
 * Average size-fee rate over a trader's next `tradeAnchor` of volume, given what
 * they already converted in the lookback (`priorAnchor`, both in ₳).
 *
 * The marginal rate at cumulative volume x is MAX * x / (x + HALF). Its average
 * over [prior, prior + trade] has the closed form below, which is what makes the
 * fee independent of how a conversion is split.
 */
export function sizeFeeRate(tradeAnchor: number, priorAnchor = 0): number {
  if (!(tradeAnchor > 0) || !Number.isFinite(tradeAnchor)) return 0;
  const prior = Number.isFinite(priorAnchor) && priorAnchor > 0 ? priorAnchor : 0;
  const half = FOREX_SIZE_FEE_HALF_ANCHOR;
  // log1p keeps a small trade's fee from drowning in rounding error.
  const integral = tradeAnchor - half * Math.log1p(tradeAnchor / (prior + half));
  return FOREX_SIZE_FEE_MAX * (Math.max(0, integral) / tradeAnchor);
}

/**
 * Fee multiplier for one currency from its gross ₳ volume over the lookback.
 * Missing data (a currency with no forex turn behind it yet) is neutral.
 */
export function liquidityFeeMultiplier(recentVolumeAnchor: number | null | undefined): number {
  if (recentVolumeAnchor == null || !Number.isFinite(recentVolumeAnchor)) return 1;
  const ratio = FOREX_LIQUIDITY_REFERENCE_VOLUME / Math.max(recentVolumeAnchor, 1);
  return Math.min(FOREX_LIQUIDITY_FEE_MAX, Math.max(FOREX_LIQUIDITY_FEE_MIN, Math.sqrt(ratio)));
}

export interface PlayerTradeFeeInput {
  /** Base spread rate already scaled by the chair's spread strength. */
  baseSpread: number;
  /** This trade's size in ₳. */
  tradeAnchor: number;
  /** What the trader already converted over the lookback, in ₳. */
  priorAnchor?: number;
  /** Gross ₳ volume of the currency being sold, over the lookback. */
  fromVolumeAnchor?: number | null;
  /** Gross ₳ volume of the currency being bought, over the lookback. */
  toVolumeAnchor?: number | null;
}

/** Total fee rate for a player's conversion. The quieter of the two legs sets the scale. */
export function playerTradeFeeRate(input: PlayerTradeFeeInput): number {
  const base = Number.isFinite(input.baseSpread) && input.baseSpread > 0 ? input.baseSpread : 0;
  const size = sizeFeeRate(input.tradeAnchor, input.priorAnchor ?? 0);
  const liquidity = Math.max(
    liquidityFeeMultiplier(input.fromVolumeAnchor),
    liquidityFeeMultiplier(input.toVolumeAnchor)
  );
  return Math.min(FOREX_MAX_TRADE_FEE, (base + size) * liquidity);
}

/**
 * Gross ₳ volume a stored rate document carries for its currency (the forex
 * turn writes buyVolume24 / sellVolume24). Null when the document has neither,
 * such as a projected quote, which leaves the fee neutral.
 */
export function recentVolumeAnchorOf(rate: object | null | undefined): number | null {
  if (!rate) return null;
  const { buyVolume24, sellVolume24 } = rate as { buyVolume24?: unknown; sellVolume24?: unknown };
  const buy = typeof buyVolume24 === "number" && Number.isFinite(buyVolume24) ? buyVolume24 : null;
  const sell =
    typeof sellVolume24 === "number" && Number.isFinite(sellVolume24) ? sellVolume24 : null;
  if (buy == null && sell == null) return null;
  return (buy ?? 0) + (sell ?? 0);
}
