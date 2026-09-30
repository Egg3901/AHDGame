/**
 * Purchase conversion includes the source monetary authority's spread policy.
 * purchaseConversionSpend covers rounding losses without exceeding the wallet;
 * fixed euro settlement charges no spread.
 */
import {
  MARKET_MAKER_SPREAD,
  clampForexSpreadStrength,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import {
  euroLedgerSpendForTarget,
  euroLedgerCrossRate,
  type EuroMonetaryUnion,
} from "../euro/rules";

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

export function purchaseSpreadRate(
  from: CurrencyCode,
  to: CurrencyCode,
  union?: EuroMonetaryUnion,
  strengths?: Partial<Record<CurrencyCode, number>> | null
): number {
  if (from === to || euroLedgerCrossRate(union, from, to) != null) return 0;
  const member =
    union && Object.values(union.members).some((entry) => entry?.ledgerCurrency === from);
  const policyCurrency = member && union ? union.anchorCurrency : from;
  return MARKET_MAKER_SPREAD * clampForexSpreadStrength(strengths?.[policyCurrency]);
}
