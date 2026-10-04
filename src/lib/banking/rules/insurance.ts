/**
 * Deposit insurance arithmetic: the insured cap reference, the risk-weighted
 * premium, and the two sums the premium is computed over.
 *
 * The shell (`banking/insurance.ts`) owns the fund document, the era and FX
 * scaling of the cap, and failure resolution.
 */

import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

/** Modern-era USD reference insured cap. Era/FX scaled at call time. */
export const INSURED_CAP_REFERENCE_USD = 5_000_000;

/** Provisional annual premium rate on insured deposits (before risk weight). */
export const BASE_PREMIUM_ANNUAL = 0.004;

/** Required evidence before a fund replaces the provisional premium rate. */
export const PREMIUM_EVIDENCE_MIN_YEARS = 10;
export const PREMIUM_EVIDENCE_MIN_PAID_CLAIMS = 3;
/** Keep one year of observed net claims in the currency fund. */
export const INSURANCE_RESERVE_TARGET_YEARS = 1;
/** Refill a reserve shortfall over five years of the observed exposure base. */
export const INSURANCE_RESERVE_REFILL_YEARS = 5;

export interface InsurancePremiumEvidence {
  currentTurn: number;
  firstMeasuredTurn: number;
  insuredDepositTurns: number;
  paidClaims: number;
  grossPayouts: number;
  recoveries: number;
  fundBalance: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pure per-turn premium on insured deposits, risk-weighted by reserve cover.
 *
 *   riskWeight = clamp(2 - actual / max(required, 0.01), 0.5, 3)
 *   premium = insuredDeposits * BASE_PREMIUM_ANNUAL / TURNS_PER_YEAR * riskWeight
 *
 * Thin reserves (actual << required) pay more; well-reserved banks pay less.
 */
export function computeInsurancePremium(
  insuredDeposits: number,
  reserveRatioActual: number,
  reserveRatioRequired: number,
  baseAnnualRate = BASE_PREMIUM_ANNUAL
): number {
  const deposits =
    typeof insuredDeposits === "number" && Number.isFinite(insuredDeposits)
      ? Math.max(0, insuredDeposits)
      : 0;
  if (!(deposits > 0)) return 0;

  const actual =
    typeof reserveRatioActual === "number" && Number.isFinite(reserveRatioActual)
      ? Math.max(0, reserveRatioActual)
      : 0;
  const required =
    typeof reserveRatioRequired === "number" && Number.isFinite(reserveRatioRequired)
      ? reserveRatioRequired
      : 0;
  const riskWeight = clamp(2 - actual / Math.max(required, 0.01), 0.5, 3);
  const safeBaseRate = Number.isFinite(baseAnnualRate) ? Math.max(0, baseAnnualRate) : 0;
  return (deposits * safeBaseRate * riskWeight) / TURNS_PER_YEAR;
}

/**
 * Price from measured currency-fund claims only after ten years of exposure
 * and three paid resolutions. Legacy lifetime counters are deliberately not
 * inputs because they predate the new deposit-turn denominator and omit
 * recovery totals. Until the cohort is credible, preserve the 0.4% rate.
 */
export function computeEvidenceBasedPremiumAnnualRate(evidence: InsurancePremiumEvidence): number {
  const elapsedTurns = evidence.currentTurn - evidence.firstMeasuredTurn + 1;
  if (
    !Number.isFinite(elapsedTurns) ||
    elapsedTurns < PREMIUM_EVIDENCE_MIN_YEARS * TURNS_PER_YEAR ||
    !Number.isFinite(evidence.insuredDepositTurns) ||
    evidence.insuredDepositTurns <= 0 ||
    !Number.isFinite(evidence.paidClaims) ||
    evidence.paidClaims < PREMIUM_EVIDENCE_MIN_PAID_CLAIMS
  ) {
    return BASE_PREMIUM_ANNUAL;
  }

  const grossPayouts = Number.isFinite(evidence.grossPayouts)
    ? Math.max(0, evidence.grossPayouts)
    : 0;
  const recoveries = Number.isFinite(evidence.recoveries) ? Math.max(0, evidence.recoveries) : 0;
  const netClaims = Math.max(0, grossPayouts - recoveries);
  const observedAnnualLossRate = (netClaims * TURNS_PER_YEAR) / evidence.insuredDepositTurns;
  const averageAnnualInsuredDeposits = evidence.insuredDepositTurns / elapsedTurns;
  if (!(averageAnnualInsuredDeposits > 0)) return BASE_PREMIUM_ANNUAL;

  const targetReserve =
    observedAnnualLossRate * averageAnnualInsuredDeposits * INSURANCE_RESERVE_TARGET_YEARS;
  const reserveGap = Math.max(0, targetReserve - Math.max(0, evidence.fundBalance));
  const annualReserveRefillRate =
    reserveGap / (averageAnnualInsuredDeposits * INSURANCE_RESERVE_REFILL_YEARS);
  return Math.max(BASE_PREMIUM_ANNUAL, observedAnnualLossRate + annualReserveRefillRate);
}

/** Sum of min(balance, cap) over player depositors. */
export function sumInsuredPlayerDeposits(balances: readonly number[], insuredCap: number): number {
  const cap = Math.max(0, insuredCap);
  let total = 0;
  for (const bal of balances) {
    if (!(bal > 0)) continue;
    total += Math.min(bal, cap);
  }
  return total;
}

/** Actual reserve ratio used for the premium risk weight (liquid / deposits). */
export function computeReserveRatioActual(liquidCapital: number, totalDeposits: number): number {
  const deposits = Math.max(0, totalDeposits);
  if (!(deposits > 0)) return 1;
  return Math.max(0, liquidCapital) / deposits;
}
