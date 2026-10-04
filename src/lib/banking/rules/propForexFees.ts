/**
 * Forex fees increase with the bank's recent trading size and market liquidity.
 * quotePropForexFee divides the rounded cash fee into revenue, reserve and burn;
 * addPropForexVolume counts purchases and sales in the same lookback.
 */
import {
  MARKET_MAKER_SPREAD,
  SPREAD_FEE_FOREX_REVENUE_RATIO,
  SPREAD_FEE_RESERVE_RATIO,
  VOLUME_LOOKBACK_TURNS,
  clampForexSpreadStrength,
} from "@/lib/constants/currencies";
import { playerTradeFeeRate } from "@/lib/currency/tradeFees";
import { roundSavingsAmount } from "@/lib/currency/savingsInterest";
import type { CurrencyCode } from "@/lib/constants/currencies";

export interface PropForexVolume {
  turn: number;
  anchorAmount: number;
}

/** A bank is the trader. Keep both sides of each forex order in its lookback. */
export function recentPropForexVolume(rows: readonly PropForexVolume[], turn: number): number {
  return rows.reduce(
    (sum, row) =>
      sum +
      (Number.isSafeInteger(row.turn) &&
      row.turn >= Math.max(1, turn - VOLUME_LOOKBACK_TURNS) &&
      row.turn <= turn &&
      Number.isFinite(row.anchorAmount) &&
      row.anchorAmount > 0
        ? row.anchorAmount
        : 0),
    0
  );
}

export function addPropForexVolume(
  rows: readonly PropForexVolume[],
  turn: number,
  anchorAmount: number
): PropForexVolume[] {
  const totals = new Map<number, number>();
  for (const row of [...rows, { turn, anchorAmount }]) {
    if (
      row.turn < Math.max(1, turn - VOLUME_LOOKBACK_TURNS) ||
      row.turn > turn ||
      !Number.isSafeInteger(row.turn) ||
      !Number.isFinite(row.anchorAmount) ||
      row.anchorAmount <= 0
    )
      continue;
    totals.set(row.turn, (totals.get(row.turn) ?? 0) + row.anchorAmount);
  }
  return [...totals]
    .sort(([a], [b]) => a - b)
    .map(([turn, anchorAmount]) => ({ turn, anchorAmount }));
}

/** Quotes are in the bank's cash currency. Fees do not become position assets. */
export function quotePropForexFee(input: {
  markLocal: number;
  currencyCode: CurrencyCode;
  homeRate: number;
  spreadStrength?: number;
  priorAnchor: number;
  homeVolumeAnchor?: number | null;
  foreignVolumeAnchor?: number | null;
}) {
  if (
    !Number.isFinite(input.markLocal) ||
    input.markLocal <= 0 ||
    !Number.isFinite(input.homeRate) ||
    input.homeRate <= 0
  )
    throw new Error("Invalid forex cash quote");
  const anchorAmount = input.markLocal / input.homeRate;
  const feeRate = playerTradeFeeRate({
    baseSpread: MARKET_MAKER_SPREAD * clampForexSpreadStrength(input.spreadStrength),
    tradeAnchor: anchorAmount,
    priorAnchor: input.priorAnchor,
    fromVolumeAnchor: input.homeVolumeAnchor,
    toVolumeAnchor: input.foreignVolumeAnchor,
  });
  const feeLocal = roundSavingsAmount(input.markLocal * feeRate, input.currencyCode);
  const revenueLocal = roundSavingsAmount(
    feeLocal * SPREAD_FEE_FOREX_REVENUE_RATIO,
    input.currencyCode
  );
  const reserveLocal = roundSavingsAmount(feeLocal * SPREAD_FEE_RESERVE_RATIO, input.currencyCode);
  return {
    anchorAmount,
    feeRate,
    feeLocal,
    revenueLocal,
    reserveLocal,
    burnLocal: roundSavingsAmount(
      Math.max(0, feeLocal - revenueLocal - reserveLocal),
      input.currencyCode
    ),
  };
}

export interface PropForexFeeReceipt {
  key: string;
  turn: number;
  charteredTurn: number;
  currencyCode: string;
  centralBankId: string;
  feeLocal: number;
  revenueLocal: number;
  reserveLocal: number;
  burnLocal: number;
}
