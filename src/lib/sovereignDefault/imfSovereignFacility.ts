/**
 * Pure facility-setup math for sovereign IMF bailouts.
 *
 * Principal equals next-quarter rollover (face value of bonds maturing in next
 * 12 turns) plus the projected annual deficit. Negative rollover or surplus
 * inputs are clamped to 0 — surplus countries can still take a bailout when
 * facing failed-auction conditions (the rollover floor still applies).
 *
 * The orchestrator is the only caller; it validates inputs upstream so we
 * don't add NaN guards here.
 */

import {
  IMF_SOVEREIGN_DEFAULT_RATE,
  IMF_SOVEREIGN_AMORTIZATION_TURNS,
  IMF_SOVEREIGN_INCOME_CAPTURE_DEFAULT,
  IMF_SOVEREIGN_INCOME_CAPTURE_MIN,
  IMF_SOVEREIGN_INCOME_CAPTURE_CAP,
} from "./constants";

export interface SovereignBailoutInputs {
  rolloverFaceValue: number;
  annualDeficit: number;
}

export interface SovereignBailoutTerms {
  principal: number;
  annualRatePercent: number;
  amortizationTurns: number;
  incomeCaptureFraction: number;
}

export function computeSovereignBailoutTerms(
  inputs: SovereignBailoutInputs
): SovereignBailoutTerms {
  const rollover = Math.max(0, inputs.rolloverFaceValue);
  const deficit = Math.max(0, inputs.annualDeficit);
  const principal = rollover + deficit;

  const capture = Math.min(
    IMF_SOVEREIGN_INCOME_CAPTURE_CAP,
    Math.max(IMF_SOVEREIGN_INCOME_CAPTURE_MIN, IMF_SOVEREIGN_INCOME_CAPTURE_DEFAULT)
  );

  return {
    principal,
    annualRatePercent: IMF_SOVEREIGN_DEFAULT_RATE * 100,
    amortizationTurns: IMF_SOVEREIGN_AMORTIZATION_TURNS,
    incomeCaptureFraction: capture,
  };
}
