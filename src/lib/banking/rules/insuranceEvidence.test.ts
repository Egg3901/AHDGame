import { describe, expect, it } from "vitest";
import {
  BASE_PREMIUM_ANNUAL,
  computeEvidenceBasedPremiumAnnualRate,
  INSURANCE_RESERVE_REFILL_YEARS,
  INSURANCE_RESERVE_TARGET_YEARS,
  PREMIUM_BASE_ANNUAL_CEILING,
  PREMIUM_EVIDENCE_MIN_PAID_CLAIMS,
  PREMIUM_EVIDENCE_MIN_YEARS,
} from "./insurance";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

const FULL_WINDOW_TURNS = PREMIUM_EVIDENCE_MIN_YEARS * TURNS_PER_YEAR;

// $100 average insured deposits over a full credibility window.
const credibleEvidence = {
  currentTurn: FULL_WINDOW_TURNS - 1,
  firstMeasuredTurn: 0,
  insuredDepositTurns: 100 * FULL_WINDOW_TURNS,
  paidClaims: PREMIUM_EVIDENCE_MIN_PAID_CLAIMS,
  grossPayouts: 10,
  recoveries: 0,
  fundBalance: 0,
};

describe("evidence-based insurance premium rate", () => {
  it("keeps the provisional rate with no paid claim or no measured exposure", () => {
    expect(computeEvidenceBasedPremiumAnnualRate({ ...credibleEvidence, paidClaims: 0 })).toBe(
      BASE_PREMIUM_ANNUAL
    );
    expect(
      computeEvidenceBasedPremiumAnnualRate({ ...credibleEvidence, insuredDepositTurns: 0 })
    ).toBe(BASE_PREMIUM_ANNUAL);
    expect(
      computeEvidenceBasedPremiumAnnualRate({ ...credibleEvidence, currentTurn: Number.NaN })
    ).toBe(BASE_PREMIUM_ANNUAL);
  });

  it("prices annualized net claims and a one-year reserve refill over five years", () => {
    // $10 net loss over ten years on $100 average insured deposits is a 1%
    // annual loss rate, a $1 one-year reserve target, and a 0.2% refill rate.
    expect(computeEvidenceBasedPremiumAnnualRate(credibleEvidence)).toBeCloseTo(0.012, 12);
    expect(INSURANCE_RESERVE_TARGET_YEARS).toBe(1);
    expect(INSURANCE_RESERVE_REFILL_YEARS).toBe(5);
  });

  it("subtracts recoveries from the same measured claim cohort", () => {
    const rate = computeEvidenceBasedPremiumAnnualRate({
      ...credibleEvidence,
      recoveries: 5,
      fundBalance: 3,
    });
    // $5 net loss gives a 0.5% annual loss rate and a $0.50 reserve target,
    // which a $3 fund already covers.
    expect(rate).toBeCloseTo(0.005, 12);
  });

  it("does not lower the provisional rate when measured net claims are zero", () => {
    expect(
      computeEvidenceBasedPremiumAnnualRate({
        ...credibleEvidence,
        grossPayouts: 20,
        recoveries: 20,
      })
    ).toBe(BASE_PREMIUM_ANNUAL);
  });

  it("blends toward the measured rate in proportion to elapsed years", () => {
    // Half the window: $5 net loss on $100 average deposits over five years is
    // also a 1.2% measured rate, weighted at 50% credibility.
    const half = FULL_WINDOW_TURNS / 2;
    const rate = computeEvidenceBasedPremiumAnnualRate({
      ...credibleEvidence,
      currentTurn: half - 1,
      insuredDepositTurns: 100 * half,
      grossPayouts: 5,
    });
    expect(rate).toBeCloseTo(BASE_PREMIUM_ANNUAL + 0.5 * (0.012 - BASE_PREMIUM_ANNUAL), 12);
  });

  it("blends toward the measured rate in proportion to paid claims", () => {
    const rate = computeEvidenceBasedPremiumAnnualRate({ ...credibleEvidence, paidClaims: 1 });
    expect(rate).toBeCloseTo(BASE_PREMIUM_ANNUAL + (0.012 - BASE_PREMIUM_ANNUAL) / 3, 12);
  });

  it("caps the base rate so one large failure cannot price survivors out", () => {
    expect(computeEvidenceBasedPremiumAnnualRate({ ...credibleEvidence, grossPayouts: 400 })).toBe(
      PREMIUM_BASE_ANNUAL_CEILING
    );
  });
});
