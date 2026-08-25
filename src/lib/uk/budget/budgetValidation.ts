import { KNOWN_SPENDING_CATEGORIES } from "@/lib/constants/economicModels";
import { UK_LAWS } from "@/lib/politicalLegislation/laws/ukLaws";

/**
 * Pure validation for a UK Budget (epic #856, ticket #858).
 * No DB, no side effects — reused by the API and the vote path.
 */

/** Real UK tax lever ids (e.g. "uk.tax.incomeTax"). */
export const UK_TAX_LEVER_IDS = new Set(
  UK_LAWS.filter((l) => l.id.startsWith("uk.tax.")).map((l) => l.id)
);

/** Spending shares must sum to within this tolerance of 100. */
export const SPENDING_SUM_TOLERANCE = 0.5;
/** Maximum permitted tax rate (percent). */
export const MAX_TAX_RATE = 100;

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export function validateSpendingAllocations(allocations: Record<string, number>): ValidationResult {
  let sum = 0;
  for (const [category, share] of Object.entries(allocations)) {
    if (!KNOWN_SPENDING_CATEGORIES.has(category)) {
      return { ok: false, error: `unknown spending category: ${category}` };
    }
    if (!Number.isFinite(share) || share < 0) {
      return { ok: false, error: `invalid share for ${category}` };
    }
    sum += share;
  }
  if (Math.abs(sum - 100) > SPENDING_SUM_TOLERANCE) {
    return { ok: false, error: `spending shares must sum to 100 (got ${sum.toFixed(1)})` };
  }
  return { ok: true };
}

export function validateTaxRates(rates: Record<string, number>): ValidationResult {
  for (const [leverId, rate] of Object.entries(rates)) {
    if (!UK_TAX_LEVER_IDS.has(leverId)) {
      return { ok: false, error: `unknown tax lever: ${leverId}` };
    }
    if (!Number.isFinite(rate) || rate < 0 || rate > MAX_TAX_RATE) {
      return { ok: false, error: `invalid rate for ${leverId}` };
    }
  }
  return { ok: true };
}

export function validateBudget(args: {
  taxRates: Record<string, number>;
  spendingAllocations: Record<string, number>;
}): ValidationResult {
  const tax = validateTaxRates(args.taxRates);
  if (!tax.ok) return tax;
  return validateSpendingAllocations(args.spendingAllocations);
}
