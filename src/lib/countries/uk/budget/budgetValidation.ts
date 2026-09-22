import { UK_LAWS } from "@/lib/politicalLegislation/laws/ukLaws";

/**
 * Pure validation for a UK Budget (epic #856, ticket #858).
 * No DB, no side effects — reused by the API and the vote path.
 */

/** Real UK tax lever ids (e.g. "uk.tax.incomeTax"). */
export const UK_TAX_LEVER_IDS = new Set(
  UK_LAWS.filter((l) => l.id.startsWith("uk.tax.")).map((l) => l.id)
);
const UK_TAX_LAWS_BY_ID = new Map(
  UK_LAWS.filter((law) => law.kind === "tax").map((law) => [law.id, law])
);

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export function validateTaxRates(rates: Record<string, number>): ValidationResult {
  for (const [leverId, rate] of Object.entries(rates)) {
    const law = UK_TAX_LAWS_BY_ID.get(leverId);
    if (!law?.taxPolicy) {
      return { ok: false, error: `unknown tax lever: ${leverId}` };
    }
    const { minRate, maxRate, step } = law.taxPolicy;
    if (!Number.isFinite(rate) || rate < minRate || rate > maxRate) {
      return { ok: false, error: `invalid rate for ${leverId}` };
    }
    const gridSteps = (rate - minRate) / step;
    if (Math.abs(gridSteps - Math.round(gridSteps)) > 1e-9) {
      return { ok: false, error: `${leverId} must move in steps of ${step}` };
    }
  }
  return { ok: true };
}

export function validateProgramLevels(levels: Record<string, number>): ValidationResult {
  const lawsById = new Map(UK_LAWS.map((law) => [law.id, law]));
  for (const [lawId, level] of Object.entries(levels)) {
    const law = lawsById.get(lawId);
    if (!law || law.kind === "tax" || law.allowedScope === "regional") {
      return { ok: false, error: `unknown UK national programme: ${lawId}` };
    }
    if (!Number.isInteger(level) || level < 0 || level > 4) {
      return { ok: false, error: `${law.title} level must be between 0 and 4` };
    }
  }
  return { ok: true };
}

export function validateBudget(args: {
  taxRates: Record<string, number>;
  programLevels: Record<string, number>;
}): ValidationResult {
  const tax = validateTaxRates(args.taxRates);
  if (!tax.ok) return tax;
  return validateProgramLevels(args.programLevels);
}
