/**
 * Purchase conversion includes the source monetary authority's spread policy.
 * purchaseConversionSpend covers rounding losses without exceeding the wallet;
 * fixed euro settlement charges no spread.
 */
import { MARKET_MAKER_SPREAD, clampForexSpreadStrength } from "@/lib/constants/currencies";
import { euroLedgerSpendForTarget } from "../euro/rules";

export function purchaseConversionRequired(
  target: number,
  crossRate: number,
  fixedSettlement: boolean,
  spreadStrength?: number
): number {
  return fixedSettlement
    ? euroLedgerSpendForTarget(target, crossRate)
    : target / ((1 - MARKET_MAKER_SPREAD * clampForexSpreadStrength(spreadStrength)) * crossRate);
}

export function purchaseConversionSpend(
  target: number,
  crossRate: number,
  balance: number,
  fixedSettlement: boolean,
  spreadStrength?: number
): number {
  if (!Number.isFinite(crossRate) || crossRate <= 0) return Math.max(0, balance);
  const required = purchaseConversionRequired(target, crossRate, fixedSettlement, spreadStrength);
  const buffer = fixedSettlement ? 0 : Math.max(1, Math.ceil(1 / crossRate));
  return Math.min(balance, required + buffer);
}
