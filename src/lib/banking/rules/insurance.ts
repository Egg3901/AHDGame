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

/**
 * Evidence for full credibility: ten measured years and three paid claims.
 * Below either threshold the measured rate is blended in proportionally, so a
 * fund moves from the provisional rate toward its measured rate gradually
 * instead of jumping on the turn the cohort crosses a threshold.
 */
export const PREMIUM_EVIDENCE_MIN_YEARS = 10;
export const PREMIUM_EVIDENCE_MIN_PAID_CLAIMS = 3;
/**
 * Ceiling on the annual base rate (before the 0.5x to 3x risk weight). A
 * single large failure in a thin cohort must not price surviving banks into a
 * failure spiral; claims beyond what the ceiling funds fall to the funded
 * Treasury backstop, which already covers any fund shortfall.
 */
export const PREMIUM_BASE_ANNUAL_CEILING = 0.02;
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
 * Annual base premium rate for a currency fund.
 *
 *   lossRate   = netClaims * TURNS_PER_YEAR / insuredDepositTurns
 *   target     = lossRate * avgInsuredDeposits * INSURANCE_RESERVE_TARGET_YEARS
 *   refillRate = max(0, target - fundBalance) / (avgInsuredDeposits * INSURANCE_RESERVE_REFILL_YEARS)
 *   measured   = lossRate + refillRate
 *   z          = min(1, years / MIN_YEARS) * min(1, paidClaims / MIN_PAID_CLAIMS)
 *   rate       = clamp(BASE + z * (measured - BASE), BASE, CEILING)
 *
 * Inputs are deterministic counters from the measured cohort only. Legacy
 * lifetime counters are deliberately not inputs because they predate the
 * deposit-turn denominator and omit recovery totals. With no measured paid
 * claim the provisional 0.4% rate is returned unchanged.
 */
export function computeEvidenceBasedPremiumAnnualRate(evidence: InsurancePremiumEvidence): number {
  const elapsedTurns = evidence.currentTurn - evidence.firstMeasuredTurn + 1;
  if (
    !Number.isFinite(elapsedTurns) ||
    elapsedTurns <= 0 ||
    !Number.isFinite(evidence.insuredDepositTurns) ||
    evidence.insuredDepositTurns <= 0 ||
    !Number.isFinite(evidence.paidClaims) ||
    evidence.paidClaims <= 0
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
  const fundBalance = Number.isFinite(evidence.fundBalance) ? Math.max(0, evidence.fundBalance) : 0;
  const reserveGap = Math.max(0, targetReserve - fundBalance);
  const annualReserveRefillRate =
    reserveGap / (averageAnnualInsuredDeposits * INSURANCE_RESERVE_REFILL_YEARS);
  const measuredRate = observedAnnualLossRate + annualReserveRefillRate;

  const credibility =
    Math.min(1, elapsedTurns / (PREMIUM_EVIDENCE_MIN_YEARS * TURNS_PER_YEAR)) *
    Math.min(1, evidence.paidClaims / PREMIUM_EVIDENCE_MIN_PAID_CLAIMS);
  const blended = BASE_PREMIUM_ANNUAL + credibility * (measuredRate - BASE_PREMIUM_ANNUAL);
  return clamp(blended, BASE_PREMIUM_ANNUAL, PREMIUM_BASE_ANNUAL_CEILING);
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
