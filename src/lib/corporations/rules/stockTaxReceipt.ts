/**
 * Stock sale taxes apply to profits after cost basis. stockSaleTaxReceipt freezes
 * the two taxable amounts in the seller's credited wallet units for the assessment turn.
 */
import { holdingSaleGains, type ShareHoldingTerms } from "./holdingTerms";
import type { StockTaxReceipt, PendingStockTaxReceipt } from "@/lib/budget/rules/capitalGainsTax";
export function stockSaleTaxReceipt(input: {
  holdingTerms: ShareHoldingTerms;
  proceedsAnchor: number;
  proceedsCredited: number;
  saleTurn: number;
  assessmentTurn: number;
}): StockTaxReceipt {
  if (!Number.isFinite(input.proceedsCredited) || input.proceedsCredited < 0)
    throw new Error("Invalid credited stock proceeds");
  if (!Number.isSafeInteger(input.assessmentTurn) || input.assessmentTurn < input.saleTurn)
    throw new Error("Invalid stock assessment turn");
  const gains = holdingSaleGains(input.holdingTerms, input.proceedsAnchor, input.saleTurn);
  const ratio = input.proceedsAnchor > 0 ? input.proceedsCredited / input.proceedsAnchor : 0;
  return {
    version: 1,
    assessmentTurn: input.assessmentTurn,
    incomeAmount: gains.incomeGainAnchor * ratio,
    capitalAmount: gains.capitalGainAnchor * ratio,
    costBasisAnchor: gains.costBasisAnchor,
  };
}
export function pendingStockTaxReceipt(
  input: Parameters<typeof stockSaleTaxReceipt>[0] & { id: string; currencyCode: string }
): PendingStockTaxReceipt {
  if (!input.id || !input.currencyCode)
    throw new Error("Stock tax credit needs an identity and currency");
  return {
    ...stockSaleTaxReceipt(input),
    id: input.id,
    saleTurn: input.saleTurn,
    amount: input.proceedsCredited,
    anchorAmount: input.proceedsAnchor,
    currencyCode: input.currencyCode,
  };
}
