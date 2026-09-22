/**
 * Canonical outstanding sovereign principal (refs #1975).
 *
 * End-of-turn `federalBudget.debt.principal` MUST equal the sum of authoritative
 * outstanding sovereign debt, defined here. Treasury cash (`treasuryBalance`) is a
 * separate field: a country may hold cash assets and bond debt simultaneously, so
 * nothing derives principal from the balance anymore.
 *
 * Outstanding contribution of one bond:
 *   - only `issuerType: "sovereign"` bonds count (corporate paper is not crown debt);
 *   - `matured` and `defaulted` bonds no longer count (repudiated paper leaves the
 *     stock; redeemed paper was paid out);
 *   - a restructured bond counts at face minus its haircut fraction
 *     (`restructureHaircutPercent`, e.g. 0.4 for RESTRUCTURE_HAIRCUT). The
 *     restructure mutation stamps the haircut without rewriting `totalIssued`
 *     (units x face identity and holder payouts stay intact), so the haircut
 *     adjustment lives here, in the one derivation every writer shares.
 *
 * Pure rules module: plain data in, plain data out. No DB, clock, or randomness.
 */
import type { Bond } from "@/lib/db/types/bond";
import type { CreditRating, SovereignRiskAnchor } from "@/lib/db/types/budget";
import {
  calculateCreditRating,
  calculateInterestRate,
  getSovereignConfidencePremium,
} from "@/lib/budget/debt";

export type SovereignPrincipalBond = Pick<
  Bond,
  "issuerType" | "matured" | "defaulted" | "totalIssued" | "restructureHaircutPercent"
>;

/** Whether this bond is part of the outstanding sovereign stock. */
export function isOutstandingSovereignBond(
  bond: Pick<Bond, "issuerType" | "matured" | "defaulted">
): boolean {
  return bond.issuerType === "sovereign" && !bond.matured && !bond.defaulted;
}

/**
 * One bond's contribution to outstanding principal: face minus any restructure
 * haircut. A haircut outside [0, 1) is treated as no haircut (defensive: the
 * field is a fraction like 0.4, never a percent).
 */
export function sovereignBondOutstanding(bond: SovereignPrincipalBond): number {
  if (!isOutstandingSovereignBond(bond)) return 0;
  const face = bond.totalIssued ?? 0;
  if (!(face > 0)) return 0;
  const haircut = bond.restructureHaircutPercent ?? 0;
  const fraction = typeof haircut === "number" && haircut > 0 && haircut < 1 ? haircut : 0;
  return Math.max(0, face * (1 - fraction));
}

/** Sum of authoritative outstanding sovereign debt across a bond list. */
export function sumOutstandingSovereignPrincipal(bonds: SovereignPrincipalBond[]): number {
  let sum = 0;
  for (const bond of bonds) sum += sovereignBondOutstanding(bond);
  return sum;
}

export interface SovereignDebtTerms {
  interestRate: number;
  debtToGdpRatio: number;
  creditRating: CreditRating;
}

/**
 * Debt-service terms for a bond-owned principal stock. Same ladder math as the
 * old balance-derived path (debt.ts), but the principal is an input, not
 * `max(0, -treasuryBalance)`.
 */
export function sovereignDebtTerms(
  principal: number,
  input: {
    gdp: number;
    gdpSmoothed?: number;
    investorConfidence?: number;
    imfBailoutActive?: boolean;
    sovereignRiskAnchor?: SovereignRiskAnchor;
  }
): SovereignDebtTerms {
  const stock = Math.max(0, principal);
  const ratioGdp = input.gdpSmoothed && input.gdpSmoothed > 0 ? input.gdpSmoothed : input.gdp;
  const debtToGdpRatio = ratioGdp > 0 ? stock / ratioGdp : 0;
  return {
    interestRate:
      calculateInterestRate(debtToGdpRatio, input.imfBailoutActive, input.sovereignRiskAnchor) +
      getSovereignConfidencePremium(input.investorConfidence),
    debtToGdpRatio,
    creditRating: calculateCreditRating(debtToGdpRatio, input.sovereignRiskAnchor),
  };
}
