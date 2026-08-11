/**
 * Debt Sustainability Index (DSA) — Phase 11a.
 *
 * Continuous 0..100 sustainability score where 100 = perfectly healthy and
 * 0 = imminent crisis. Surfaced on country pages as a forward-looking
 * warning gauge — distinct from the existing 3-failed-auctions hard
 * trigger, which remains the actual fire condition.
 *
 * Combines four indicators with calibrated weights:
 *   - D/GDP penalty: 0.0 below 60%, scales linearly to -50 at 200%
 *   - Primary balance/GDP: surplus contributes up to +15; deficit penalizes up to -25
 *   - FX 10-turn depreciation: 0 below 5%, -10 at 10%, -25 at >25%
 *   - GDP growth (annual fraction): up to +10 above 3%; up to -25 below -3%
 *
 * Net score = clamp(0, 100, 80 + sum(modifiers)).
 *
 * Pure function. No DB. No randomness. Calibration constants live in
 * sovereignDefault/constants.ts so the Phase 10 balancing pass can revisit.
 */

import {
  DSA_BASELINE_SCORE,
  DSA_DGDP_FLOOR,
  DSA_DGDP_CEILING,
  DSA_DGDP_MAX_PENALTY,
  DSA_PRIMARY_SURPLUS_BONUS_CAP,
  DSA_PRIMARY_DEFICIT_PENALTY_CAP,
  DSA_PRIMARY_BALANCE_RATE,
  DSA_FX_THRESHOLD,
  DSA_FX_CEILING,
  DSA_FX_MAX_PENALTY,
  DSA_GROWTH_BONUS_CAP,
  DSA_GROWTH_PENALTY_CAP,
  DSA_GROWTH_RATE_BONUS,
  DSA_GROWTH_RATE_PENALTY,
} from "./constants";

export type DsaBand = "healthy" | "warning" | "at-risk" | "crisis";

export interface DsaInputs {
  /** Debt-to-GDP ratio, e.g. 1.05 = 105% */
  debtToGdp: number;
  /** Primary surplus / GDP ratio, e.g. -0.04 = -4% deficit */
  primarySurplusToGdp: number;
  /** FX depreciation over the lookback window (0..1) */
  fxDepreciation10t: number;
  /** Annual GDP growth as a fraction, e.g. 0.025 = 2.5% */
  annualGdpGrowth: number;
}

export interface DsaComponent {
  id: string;
  label: string;
  contribution: number;
}

export interface DsaResult {
  score: number;
  band: DsaBand;
  components: DsaComponent[];
}

export function computeDsa(inputs: DsaInputs): DsaResult {
  const components: DsaComponent[] = [];

  // D/GDP penalty: floor at 60% (no penalty), linear up to 200% (-50).
  const dgdpExcess = Math.max(0, inputs.debtToGdp - DSA_DGDP_FLOOR);
  const dgdpRange = DSA_DGDP_CEILING - DSA_DGDP_FLOOR;
  const dgdpPenalty = Math.min(
    DSA_DGDP_MAX_PENALTY,
    (dgdpExcess / dgdpRange) * DSA_DGDP_MAX_PENALTY
  );
  components.push({
    id: "dgdp",
    label: "Debt-to-GDP",
    contribution: -dgdpPenalty,
  });

  // Primary balance: ratio of surplus / GDP. Each percentage point of surplus
  // contributes DSA_PRIMARY_BALANCE_RATE points (capped both directions).
  const psContribution =
    inputs.primarySurplusToGdp >= 0
      ? Math.min(
          DSA_PRIMARY_SURPLUS_BONUS_CAP,
          inputs.primarySurplusToGdp * DSA_PRIMARY_BALANCE_RATE
        )
      : -Math.min(
          DSA_PRIMARY_DEFICIT_PENALTY_CAP,
          Math.abs(inputs.primarySurplusToGdp) * DSA_PRIMARY_BALANCE_RATE
        );
  components.push({
    id: "primary-balance",
    label: "Primary balance / GDP",
    contribution: psContribution,
  });

  // FX depreciation: 0 below 5%, scales to max penalty at the ceiling.
  const fxExcess = Math.max(0, inputs.fxDepreciation10t - DSA_FX_THRESHOLD);
  const fxRange = DSA_FX_CEILING - DSA_FX_THRESHOLD;
  const fxPenalty = Math.min(DSA_FX_MAX_PENALTY, (fxExcess / fxRange) * DSA_FX_MAX_PENALTY);
  components.push({
    id: "fx",
    label: "FX 10t depreciation",
    // Avoid negative-zero output when fxPenalty is exactly 0
    contribution: fxPenalty > 0 ? -fxPenalty : 0,
  });

  // GDP growth: positive growth helps, negative hurts (asymmetric — recession
  // hurts more than growth helps).
  let growthMod: number;
  if (inputs.annualGdpGrowth > 0) {
    growthMod = Math.min(DSA_GROWTH_BONUS_CAP, inputs.annualGdpGrowth * DSA_GROWTH_RATE_BONUS);
  } else if (inputs.annualGdpGrowth < 0) {
    growthMod = -Math.min(
      DSA_GROWTH_PENALTY_CAP,
      Math.abs(inputs.annualGdpGrowth) * DSA_GROWTH_RATE_PENALTY
    );
  } else {
    growthMod = 0;
  }
  components.push({
    id: "growth",
    label: "Annual GDP growth",
    contribution: growthMod,
  });

  const sumMods = components.reduce((a, c) => a + c.contribution, 0);
  const score = Math.max(0, Math.min(100, DSA_BASELINE_SCORE + sumMods));

  const band: DsaBand =
    score >= 80 ? "healthy" : score >= 50 ? "warning" : score >= 30 ? "at-risk" : "crisis";

  return { score, band, components };
}
