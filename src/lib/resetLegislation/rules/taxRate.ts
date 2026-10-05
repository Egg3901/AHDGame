/** Pure exact-rate validation; revenue remains the existing budget engine's job. */
export interface TaxRateOption {
  rate?: number;
}

export interface TaxRateBounds {
  min: number;
  max: number;
  /** Hundredth of a percentage point preserves rates such as 1.4% and 7.65%. */
  step: 0.01;
}

export function taxRateBoundsFromExistingOptions(options: readonly TaxRateOption[]): TaxRateBounds {
  const rates = options
    .map((option) => option.rate)
    .filter((rate): rate is number => rate !== undefined);
  if (rates.length < 2 || rates.some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 100)) {
    throw new Error("tax type needs valid existing rate options");
  }
  return { min: Math.min(...rates), max: Math.max(...rates), step: 0.01 };
}

export function validateExactTaxRate(
  currentRate: number,
  proposedRate: number,
  bounds: TaxRateBounds
): { allowed: boolean; rateChange: number; reason?: "unchanged" | "outside_bounds" } {
  if (!Number.isFinite(currentRate) || !Number.isFinite(proposedRate)) {
    throw new Error("tax rates must be finite");
  }
  const onStep = Math.abs(proposedRate * 100 - Math.round(proposedRate * 100)) < 1e-7;
  if (!onStep || proposedRate < bounds.min || proposedRate > bounds.max) {
    return { allowed: false, rateChange: proposedRate - currentRate, reason: "outside_bounds" };
  }
  if (proposedRate === currentRate) return { allowed: false, rateChange: 0, reason: "unchanged" };
  return { allowed: true, rateChange: proposedRate - currentRate };
}
