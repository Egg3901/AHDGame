/**
 * Dynamic SOE efficiency penalty (spec §11.3) — replaces the old flat −15%.
 * Pure: balance logic only, no DB. Higher (less negative) = better-run SOE.
 *
 * penalty = BASE + corruptionTerm + governanceTerm + mandateTerm, clamped.
 * Metric inputs are nullable: when a state's metrics are unknown, that term
 * contributes 0, so the function degrades to BASE (+ mandate) — matching the
 * old behavior's neutrality rather than inventing drag.
 */
import {
  BASE_SOE_PENALTY,
  SOE_CORRUPTION_COEFF,
  SOE_GOVERNANCE_COEFF,
  SOE_PRICE_CONTROL_PENALTY,
  SOE_EMPLOYMENT_GUARANTEE_PENALTY,
  SOE_OVERREACH_COEFF,
  SOE_PENALTY_MIN,
  SOE_PENALTY_MAX,
} from "./constants";

export interface SoeEfficiencyInput {
  /** governance.corruptionIndex.value (0–100, higher = more corrupt). */
  corruptionIndex: number | null;
  /** governance.governmentTransparency.value (0–100, higher = better). */
  governmentTransparency: number | null;
  /** Whether this sector's resolved mandate is price-controlled. */
  priceControlled: boolean;
  /** Whether this sector's resolved mandate guarantees employment. */
  employmentGuaranteed: boolean;
  /**
   * SOCI escalation factor for the owning country (`sociMultiplier(soci)`, ≥ 1).
   * Drives the moderate overreach term. Optional — absent ⇒ 1 ⇒ no overreach
   * (regression-safe for callers that have not been wired / for private corps).
   */
  concentrationMultiplier?: number;
}

/** Term-by-term efficiency breakdown (drives the Holdings drill-down UI, spec §11.3). */
export interface SoeEfficiencyBreakdown {
  base: number;
  corruption: number;
  governance: number;
  mandate: number;
  /** Moderate diseconomy-of-state-scale term (≤ 0); 0 below the danger zone. */
  overreach: number;
  /** Sum of the terms, clamped to [SOE_PENALTY_MAX, SOE_PENALTY_MIN]. */
  total: number;
}

export function computeSoeEfficiencyBreakdown(input: SoeEfficiencyInput): SoeEfficiencyBreakdown {
  const corruption = clamp01to100(input.corruptionIndex);
  const transparency = clamp01to100(input.governmentTransparency);

  // Worse with corruption (SOE_CORRUPTION_COEFF is negative).
  const corruptionTerm = corruption === null ? 0 : (corruption / 100) * SOE_CORRUPTION_COEFF;
  // Better with governance capacity (SOE_GOVERNANCE_COEFF is positive).
  const governanceTerm = transparency === null ? 0 : (transparency / 100) * SOE_GOVERNANCE_COEFF;
  const mandateTerm =
    (input.priceControlled ? SOE_PRICE_CONTROL_PENALTY : 0) +
    (input.employmentGuaranteed ? SOE_EMPLOYMENT_GUARANTEE_PENALTY : 0);

  // Diseconomy of state scale: 0 below the danger zone (multiplier 1), growing
  // moderately as concentration climbs. The clamp below still bounds it at -25.
  const mult = input.concentrationMultiplier ?? 1;
  const overreach = SOE_OVERREACH_COEFF * Math.max(0, mult - 1);

  const raw = BASE_SOE_PENALTY + corruptionTerm + governanceTerm + mandateTerm + overreach;
  // SOE_PENALTY_MAX (-25) is the lower numeric bound; SOE_PENALTY_MIN (-5) the upper.
  const total = Math.max(SOE_PENALTY_MAX, Math.min(SOE_PENALTY_MIN, raw));
  return {
    base: BASE_SOE_PENALTY,
    corruption: corruptionTerm,
    governance: governanceTerm,
    mandate: mandateTerm,
    overreach,
    total,
  };
}

export function computeSoeEfficiencyPenalty(input: SoeEfficiencyInput): number {
  return computeSoeEfficiencyBreakdown(input).total;
}

function clamp01to100(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, v));
}
