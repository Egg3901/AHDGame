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
  reserveRatioRequired: number
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
  return (deposits * BASE_PREMIUM_ANNUAL * riskWeight) / TURNS_PER_YEAR;
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
