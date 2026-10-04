import { describe, expect, it } from "vitest";
import {
  BASE_PREMIUM_ANNUAL,
  computeEvidenceBasedPremiumAnnualRate,
  INSURANCE_RESERVE_REFILL_YEARS,
  INSURANCE_RESERVE_TARGET_YEARS,
  PREMIUM_EVIDENCE_MIN_PAID_CLAIMS,
  PREMIUM_EVIDENCE_MIN_YEARS,
} from "./insurance";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

const credibleEvidence = {
  currentTurn: PREMIUM_EVIDENCE_MIN_YEARS * TURNS_PER_YEAR - 1,
  firstMeasuredTurn: 0,
  insuredDepositTurns: 100 * PREMIUM_EVIDENCE_MIN_YEARS * TURNS_PER_YEAR,
  paidClaims: PREMIUM_EVIDENCE_MIN_PAID_CLAIMS,
  grossPayouts: 40,
  recoveries: 0,
  fundBalance: 0,
};

describe("evidence-based insurance premium rate", () => {
  it("keeps the existing rate until exposure and paid-claim evidence is credible", () => {
    expect(
      computeEvidenceBasedPremiumAnnualRate({
        ...credibleEvidence,
        currentTurn: credibleEvidence.currentTurn - 1,
      })
    ).toBe(BASE_PREMIUM_ANNUAL);
    expect(computeEvidenceBasedPremiumAnnualRate({ ...credibleEvidence, paidClaims: 2 })).toBe(
      BASE_PREMIUM_ANNUAL
    );
    expect(
      computeEvidenceBasedPremiumAnnualRate({ ...credibleEvidence, insuredDepositTurns: 0 })
    ).toBe(BASE_PREMIUM_ANNUAL);
  });

  it("prices annualized net claims and a one-year reserve refill over five years", () => {
    // $40 net loss on $100 average insured deposits produces a 4% annual
    // loss rate, $4 one-year reserve target, and 0.8% annual refill rate.
    expect(computeEvidenceBasedPremiumAnnualRate(credibleEvidence)).toBeCloseTo(0.048, 12);
    expect(INSURANCE_RESERVE_TARGET_YEARS).toBe(1);
    expect(INSURANCE_RESERVE_REFILL_YEARS).toBe(5);
  });

  it("subtracts recoveries from the same measured claim cohort", () => {
    const rate = computeEvidenceBasedPremiumAnnualRate({
      ...credibleEvidence,
      recoveries: 20,
      fundBalance: 3,
    });
    // $20 net loss on $100 average insured deposits gives a 2% annual
    // loss rate and a $2 one-year reserve target. A $3 fund covers that target.
    expect(rate).toBeCloseTo(0.02, 12);
  });

  it("does not lower the provisional rate when measured net claims are zero", () => {
    expect(
      computeEvidenceBasedPremiumAnnualRate({
        ...credibleEvidence,
        grossPayouts: 20,
        recoveries: 20,
        fundBalance: 0,
      })
    ).toBe(BASE_PREMIUM_ANNUAL);
  });
});
