import type { CreditRating, SovereignRiskAnchor } from "@/lib/db/types/budget";
import {
  calculateCreditRating,
  calculateInterestRate,
  getSovereignConfidencePremium,
} from "./debt";

/** National debt = the magnitude of a negative balance; 0 when in surplus. */
export function nationalDebtFromBalance(treasuryBalance: number): number {
  return Math.max(0, -treasuryBalance);
}

export interface DerivedFiscalState {
  principal: number;
  debtToGdpRatio: number;
  creditRating: CreditRating;
  interestRate: number;
  ceilingExceeded: boolean;
}

/**
 * Resync the derived fiscal fields from the signed treasury balance. Mirrors the
 * math `processAnnualDebt` used, but driven off the balance rather than an annual
 * deficit jump. `gdp` of 0 yields a 0 ratio (avoids divide-by-zero).
 */
export function deriveFiscalState(input: {
  treasuryBalance: number;
  gdp: number;
  /** EMA-smoothed national GDP; preferred over raw `gdp` for the debt ratio (design §5.4). */
  gdpSmoothed?: number;
  ceiling: number;
  investorConfidence?: number;
  /** Caps the tier-derived rate at the concessional IMF rate (refs #3813). */
  imfBailoutActive?: boolean;
  sovereignRiskAnchor?: SovereignRiskAnchor;
}): DerivedFiscalState {
  const principal = nationalDebtFromBalance(input.treasuryBalance);
  // Prefer the smoothed GDP so a one-period GDP swing can't trip the debt threshold.
  const ratioGdp = input.gdpSmoothed && input.gdpSmoothed > 0 ? input.gdpSmoothed : input.gdp;
  const debtToGdpRatio = ratioGdp > 0 ? principal / ratioGdp : 0;
  const interestRate =
    calculateInterestRate(debtToGdpRatio, input.imfBailoutActive, input.sovereignRiskAnchor) +
    getSovereignConfidencePremium(input.investorConfidence);
  return {
    principal,
    debtToGdpRatio,
    creditRating: calculateCreditRating(debtToGdpRatio, input.sovereignRiskAnchor),
    interestRate,
    ceilingExceeded: principal > input.ceiling,
  };
}
