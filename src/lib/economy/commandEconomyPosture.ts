import {
  NPP_DEFAULT_BUDGET_SOFTNESS,
  NPP_DEFAULT_CREDIT_AGGRESSIVENESS,
} from "@/lib/constants/commandEconomy";

function firstFinite(values: Array<number | undefined | null>, lo: number, hi: number): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(lo, Math.min(hi, value));
    }
  }
  return lo;
}

/** Player directive takes precedence over the NPP command stance and defaults. */
export function resolveGosbankPosture(
  directive:
    { creditAggressiveness?: number | null; budgetSoftness?: number | null } | null | undefined,
  stance:
    { creditAggressiveness?: number | null; budgetSoftness?: number | null } | null | undefined
): { creditAggressiveness: number; budgetSoftness: number } {
  return {
    creditAggressiveness: firstFinite(
      [
        directive?.creditAggressiveness,
        stance?.creditAggressiveness,
        NPP_DEFAULT_CREDIT_AGGRESSIVENESS,
      ],
      0,
      1
    ),
    budgetSoftness: firstFinite(
      [directive?.budgetSoftness, stance?.budgetSoftness, NPP_DEFAULT_BUDGET_SOFTNESS],
      0,
      1
    ),
  };
}
