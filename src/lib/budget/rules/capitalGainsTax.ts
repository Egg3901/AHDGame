/**
 * Capital Gains Tax applies to Long Term Holdings dividends and positive sale
 * profits. Each income tier has an independent rate, initialized from income tax.
 */
import {
  INCOME_TIERS,
  incomeTaxRate,
  type IncomeTaxRates,
  type IncomeTier,
} from "./incomeTaxTiers";
export const CAPITAL_GAINS_TAX_KEYS = {
  low: "capitalGainsTaxLow",
  middle: "capitalGainsTaxMiddle",
  high: "capitalGainsTaxHigh",
} as const;
export type CapitalGainsTaxKey = (typeof CAPITAL_GAINS_TAX_KEYS)[IncomeTier];
export interface CapitalGainsTaxRates extends IncomeTaxRates {
  capitalGainsTaxLow?: number;
  capitalGainsTaxMiddle?: number;
  capitalGainsTaxHigh?: number;
}
export function capitalGainsTierForTaxKey(key: string): IncomeTier | undefined {
  return INCOME_TIERS.find((tier) => CAPITAL_GAINS_TAX_KEYS[tier] === key);
}
export function capitalGainsTaxRate(rates: CapitalGainsTaxRates, tier: IncomeTier): number {
  const rate = rates[CAPITAL_GAINS_TAX_KEYS[tier]] ?? incomeTaxRate(rates, tier);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100)
    throw new Error("Invalid capital-gains tax rate");
  return rate;
}
export function initializeCapitalGainsTaxRates<T extends CapitalGainsTaxRates>(
  rates: T
): T & Record<CapitalGainsTaxKey, number> {
  return {
    ...rates,
    capitalGainsTaxLow: capitalGainsTaxRate(rates, "low"),
    capitalGainsTaxMiddle: capitalGainsTaxRate(rates, "middle"),
    capitalGainsTaxHigh: capitalGainsTaxRate(rates, "high"),
  };
}

/** Frozen at the committed payout/sale, in the recipient's credited currency. */
export interface StockTaxReceipt {
  version: 1;
  assessmentTurn: number;
  incomeAmount: number;
  capitalAmount: number;
  costBasisAnchor?: number;
}
/** Stored with the wallet credit and retained through the earnings lookback. */
export interface PendingStockTaxReceipt extends StockTaxReceipt {
  id: string;
  saleTurn: number;
  amount: number;
  anchorAmount: number;
  currencyCode: string;
}
/** Validate the durable wallet-credit envelope before using its identity or dates. */
export function validatePendingStockTaxReceipt(receipt: PendingStockTaxReceipt): void {
  stockTaxReceipt(receipt);
  if (
    typeof receipt.id !== "string" ||
    !receipt.id ||
    !Number.isSafeInteger(receipt.saleTurn) ||
    receipt.saleTurn < 0 ||
    receipt.saleTurn > receipt.assessmentTurn ||
    typeof receipt.currencyCode !== "string" ||
    !receipt.currencyCode ||
    ![receipt.amount, receipt.anchorAmount].every((value) => Number.isFinite(value) && value >= 0)
  )
    throw new Error("Invalid stock tax credit");
  taxableStockAmounts("stock_trade_sell", receipt.amount, receipt);
}
export function stockTaxReceipt(value: unknown): StockTaxReceipt | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("Invalid stock tax receipt");
  const receipt = value as StockTaxReceipt;
  if (
    receipt.version !== 1 ||
    !Number.isSafeInteger(receipt.assessmentTurn) ||
    receipt.assessmentTurn < 0 ||
    ![receipt.incomeAmount, receipt.capitalAmount].every(
      (amount) => Number.isFinite(amount) && amount >= 0
    ) ||
    (receipt.costBasisAnchor !== undefined &&
      (!Number.isFinite(receipt.costBasisAnchor) || receipt.costBasisAnchor < 0))
  )
    throw new Error("Invalid stock tax receipt");
  return receipt;
}
/** Keep independently accumulated dividend splits within the credited proceeds. */
export function dividendStockTaxReceipt(
  amount: number,
  capitalAmount: number,
  assessmentTurn: number
): StockTaxReceipt {
  const tolerance = Number.EPSILON * Math.max(amount, capitalAmount) * 8;
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    !Number.isFinite(capitalAmount) ||
    capitalAmount < 0 ||
    capitalAmount > amount + tolerance
  )
    throw new Error("Invalid dividend tax allocation");
  const capital = Math.min(amount, capitalAmount);
  const receipt: StockTaxReceipt = {
    version: 1,
    assessmentTurn,
    capitalAmount: capital,
    incomeAmount: amount - capital,
  };
  stockTaxReceipt(receipt);
  return receipt;
}
export function taxableStockAmounts(
  type: string,
  amount: number,
  metadata: unknown
): { income: number; capital: number; assessmentTurn?: number } {
  // Older dividend writers subtracted independently accumulated totals. Only
  // recover the exact subtraction pattern within a few floating-point units.
  // Sale receipts and materially negative allocations remain fail-closed.
  let normalized = metadata;
  if (type === "corp_dividend" && metadata && typeof metadata === "object") {
    const raw = metadata as StockTaxReceipt;
    const tolerance = Number.EPSILON * Math.max(amount, raw.capitalAmount) * 8;
    if (
      Number.isFinite(amount) &&
      amount >= 0 &&
      Number.isFinite(raw.capitalAmount) &&
      Number.isFinite(raw.incomeAmount) &&
      raw.incomeAmount < 0 &&
      raw.incomeAmount === amount - raw.capitalAmount &&
      raw.incomeAmount >= -tolerance
    )
      normalized = { ...raw, incomeAmount: 0, capitalAmount: amount };
  }
  const receipt = stockTaxReceipt(normalized);
  if (!receipt) return { income: type === "stock_trade_sell" ? 0 : amount, capital: 0 };
  if (receipt.incomeAmount + receipt.capitalAmount > amount + 1e-7)
    throw new Error("Stock tax exceeds credited proceeds");
  return {
    income: receipt.incomeAmount,
    capital: receipt.capitalAmount,
    assessmentTurn: receipt.assessmentTurn,
  };
}
