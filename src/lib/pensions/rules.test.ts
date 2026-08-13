import { describe, it, expect } from "vitest";
import {
  describeFundingBand,
  isValidContributionRate,
  PENSION_ACCRUAL_RATE,
  PENSION_CONTRIBUTION_RATE_MAX,
  PENSION_DEFICIT_RATIO,
  PENSION_LIQUIDITY_BUFFER_TURNS,
  PENSION_TOPUP_FRACTION,
  pensionAccrualForTurn,
  pensionBenefitPayment,
  pensionBenefitsDueForTurn,
  pensionInvestableCashAnchor,
  pensionRetirementsForTurn,
  pensionSchemeAssetsAnchor,
  pensionContributionForTurn,
  pensionFundingBand,
  pensionFundingRatio,
  pensionTopUpForTurn,
} from "./rules";

describe("contribution rate validity", () => {
  it("accepts the whole bargainable band including zero", () => {
    expect(isValidContributionRate(0)).toBe(true);
    expect(isValidContributionRate(PENSION_CONTRIBUTION_RATE_MAX)).toBe(true);
  });

  it("rejects a rate outside the band or not a number", () => {
    expect(isValidContributionRate(-0.01)).toBe(false);
    expect(isValidContributionRate(PENSION_CONTRIBUTION_RATE_MAX + 0.01)).toBe(false);
    expect(isValidContributionRate(Number.NaN)).toBe(false);
  });
});

describe("contribution", () => {
  it("is a share of the covered wage bill", () => {
    expect(pensionContributionForTurn({ coveredWageBill: 1000, contributionRate: 0.05 })).toBe(50);
  });

  it("charges NOTHING when the wage bill is unmeasured", () => {
    // The labour system can be off entirely. Inventing a wage bill would charge
    // an employer for workers the economy is not modelling.
    expect(pensionContributionForTurn({ coveredWageBill: 0, contributionRate: 0.05 })).toBe(0);
    expect(
      pensionContributionForTurn({ coveredWageBill: Number.NaN, contributionRate: 0.05 })
    ).toBe(0);
  });

  it("charges nothing at a zero or invalid rate", () => {
    expect(pensionContributionForTurn({ coveredWageBill: 1000, contributionRate: 0 })).toBe(0);
    expect(pensionContributionForTurn({ coveredWageBill: 1000, contributionRate: 99 })).toBe(0);
  });
});

describe("accrual", () => {
  it("is keyed off the same wage bill as the contribution", () => {
    // The two must never be measured against different populations.
    expect(pensionAccrualForTurn(1000)).toBe(1000 * PENSION_ACCRUAL_RATE);
  });

  it("stops for a workplace with no measured wages", () => {
    expect(pensionAccrualForTurn(0)).toBe(0);
  });

  it("outruns a contribution below the accrual rate, and is outrun above it", () => {
    // This is the whole bargaining question: a scheme funded below the accrual
    // rate falls behind every turn no matter how long it runs.
    const wageBill = 1000;
    const accrual = pensionAccrualForTurn(wageBill);
    const under = pensionContributionForTurn({ coveredWageBill: wageBill, contributionRate: 0.04 });
    const over = pensionContributionForTurn({
      coveredWageBill: wageBill,
      contributionRate: PENSION_CONTRIBUTION_RATE_MAX,
    });
    expect(under).toBeLessThan(accrual);
    expect(over).toBeGreaterThan(accrual);
  });
});

describe("funding ratio", () => {
  it("treats a scheme with no liabilities as funded rather than dividing by zero", () => {
    // Every scheme is in this state on the turn it is created.
    expect(pensionFundingRatio(0, 0)).toBe(1);
  });

  it("is assets over liabilities", () => {
    expect(pensionFundingRatio(900, 1000)).toBeCloseTo(0.9, 10);
  });

  it("is zero for a scheme with liabilities and no assets", () => {
    expect(pensionFundingRatio(0, 1000)).toBe(0);
  });

  it("bands on the ratio", () => {
    expect(pensionFundingBand(1.2)).toBe("surplus");
    expect(pensionFundingBand(1)).toBe("funded");
    expect(pensionFundingBand(0.95)).toBe("funded");
    expect(pensionFundingBand(0.8)).toBe("deficit");
    expect(pensionFundingBand(0.4)).toBe("critical");
  });

  it("says something actionable for every band", () => {
    for (const band of ["surplus", "funded", "deficit", "critical"] as const) {
      expect(describeFundingBand(band).length).toBeGreaterThan(0);
    }
  });
});

describe("top-up", () => {
  it("asks for nothing from a scheme in balance", () => {
    expect(pensionTopUpForTurn({ assetsAnchor: 1000, liabilitiesAnchor: 1000 })).toBe(0);
    expect(
      pensionTopUpForTurn({ assetsAnchor: PENSION_DEFICIT_RATIO * 1000, liabilitiesAnchor: 1000 })
    ).toBe(0);
  });

  it("asks for a fraction of the SHORTFALL, not of the liability", () => {
    // A scheme that is nearly funded asks for nearly nothing.
    const topUp = pensionTopUpForTurn({ assetsAnchor: 800, liabilitiesAnchor: 1000 });
    expect(topUp).toBeCloseTo((PENSION_DEFICIT_RATIO * 1000 - 800) * PENSION_TOPUP_FRACTION, 10);
  });

  it("never asks an employer to close a whole deficit in one turn", () => {
    const liabilities = 1_000_000;
    const topUp = pensionTopUpForTurn({ assetsAnchor: 0, liabilitiesAnchor: liabilities });
    expect(topUp).toBeLessThan(liabilities * 0.1);
  });

  it("scales with how bad the deficit is", () => {
    const mild = pensionTopUpForTurn({ assetsAnchor: 850, liabilitiesAnchor: 1000 });
    const severe = pensionTopUpForTurn({ assetsAnchor: 100, liabilitiesAnchor: 1000 });
    expect(severe).toBeGreaterThan(mild);
  });
});

describe("pensionSchemeAssetsAnchor (phase 2)", () => {
  it("is cash alone for a scheme that has never invested", () => {
    expect(pensionSchemeAssetsAnchor({ assetsAnchor: 5000 })).toBe(5000);
    expect(pensionSchemeAssetsAnchor({ assetsAnchor: 5000, investedValueAnchor: 0 })).toBe(5000);
  });

  it("counts fund units, so investing does not make a scheme look poorer", () => {
    // The failure this exists to prevent: a scheme moves 4000 of its 5000 cash
    // into a fund and, read off `assetsAnchor` alone, appears to have lost it.
    const before = pensionSchemeAssetsAnchor({ assetsAnchor: 5000 });
    const after = pensionSchemeAssetsAnchor({ assetsAnchor: 1000, investedValueAnchor: 4000 });
    expect(after).toBe(before);
  });

  it("keeps the funding ratio unchanged across a subscription", () => {
    const liabilities = 10_000;
    const before = pensionFundingRatio(
      pensionSchemeAssetsAnchor({ assetsAnchor: 8000 }),
      liabilities
    );
    const after = pensionFundingRatio(
      pensionSchemeAssetsAnchor({ assetsAnchor: 800, investedValueAnchor: 7200 }),
      liabilities
    );
    expect(after).toBeCloseTo(before, 10);
    expect(pensionFundingBand(after)).toBe(pensionFundingBand(before));
  });

  it("marks to market, so a fallen fund really does worsen the ratio", () => {
    const ratio = pensionFundingRatio(
      pensionSchemeAssetsAnchor({ assetsAnchor: 800, investedValueAnchor: 3600 }),
      10_000
    );
    expect(ratio).toBeCloseTo(0.44, 10);
    expect(pensionFundingBand(ratio)).toBe("critical");
  });

  it("treats a malformed or negative leg as zero rather than as a credit", () => {
    expect(pensionSchemeAssetsAnchor({ assetsAnchor: Number.NaN, investedValueAnchor: 100 })).toBe(
      100
    );
    expect(pensionSchemeAssetsAnchor({ assetsAnchor: -500, investedValueAnchor: 100 })).toBe(100);
    expect(pensionSchemeAssetsAnchor({ assetsAnchor: 100, investedValueAnchor: Number.NaN })).toBe(
      100
    );
    expect(pensionSchemeAssetsAnchor({ assetsAnchor: 100, investedValueAnchor: -50 })).toBe(100);
  });

  it("is what the top-up rule must be fed", () => {
    // Cash-only reading bills the employer; total-assets reading does not.
    const scheme = { assetsAnchor: 1000, investedValueAnchor: 8500 };
    expect(
      pensionTopUpForTurn({ assetsAnchor: scheme.assetsAnchor, liabilitiesAnchor: 10_000 })
    ).toBeGreaterThan(0);
    expect(
      pensionTopUpForTurn({
        assetsAnchor: pensionSchemeAssetsAnchor(scheme),
        liabilitiesAnchor: 10_000,
      })
    ).toBe(0);
  });
});

describe("pensionRetirementsForTurn", () => {
  it("retires a share of the claims not already in payment", () => {
    expect(
      pensionRetirementsForTurn({ liabilitiesAnchor: 10_000, benefitsInPaymentAnchor: 0 })
    ).toBeCloseTo(100, 10);
    expect(
      pensionRetirementsForTurn({ liabilitiesAnchor: 10_000, benefitsInPaymentAnchor: 5000 })
    ).toBeCloseTo(50, 10);
  });

  it("never pushes the in-payment stock past the total promise", () => {
    expect(
      pensionRetirementsForTurn({ liabilitiesAnchor: 1000, benefitsInPaymentAnchor: 1000 })
    ).toBe(0);
    expect(
      pensionRetirementsForTurn({ liabilitiesAnchor: 1000, benefitsInPaymentAnchor: 2000 })
    ).toBe(0);
  });

  it("retires nothing for a scheme with no accrued claim", () => {
    expect(pensionRetirementsForTurn({ liabilitiesAnchor: 0, benefitsInPaymentAnchor: 0 })).toBe(0);
    expect(
      pensionRetirementsForTurn({ liabilitiesAnchor: Number.NaN, benefitsInPaymentAnchor: 0 })
    ).toBe(0);
  });
});

describe("pensionBenefitsDueForTurn", () => {
  it("draws a share of the in-payment stock", () => {
    expect(pensionBenefitsDueForTurn(5000)).toBeCloseTo(100, 10);
  });

  it("is zero with nobody drawing", () => {
    expect(pensionBenefitsDueForTurn(0)).toBe(0);
    expect(pensionBenefitsDueForTurn(-1)).toBe(0);
    expect(pensionBenefitsDueForTurn(Number.NaN)).toBe(0);
  });
});

describe("pensionBenefitPayment", () => {
  it("pays in full when the cash is there", () => {
    expect(pensionBenefitPayment({ benefitsDueAnchor: 100, cashAnchor: 500 })).toEqual({
      paidAnchor: 100,
      unpaidAnchor: 0,
      cutFraction: 0,
    });
  });

  it("pays exactly the cash and cuts the rest PRO RATA", () => {
    const payment = pensionBenefitPayment({ benefitsDueAnchor: 100, cashAnchor: 40 });
    expect(payment.paidAnchor).toBe(40);
    expect(payment.unpaidAnchor).toBe(60);
    expect(payment.cutFraction).toBeCloseTo(0.6, 10);
  });

  it("NEVER pays from nowhere", () => {
    // The one invariant this whole feature rests on: a scheme with no assets
    // pays no pension. It does not overdraw and it does not mint.
    for (const cash of [0, -1, Number.NaN]) {
      const payment = pensionBenefitPayment({ benefitsDueAnchor: 100, cashAnchor: cash });
      expect(payment.paidAnchor).toBe(0);
      expect(payment.unpaidAnchor).toBe(100);
      expect(payment.cutFraction).toBe(1);
    }
  });

  it("never pays more than fell due, however much cash is sitting there", () => {
    expect(
      pensionBenefitPayment({ benefitsDueAnchor: 100, cashAnchor: 1_000_000 }).paidAnchor
    ).toBe(100);
  });

  it("is a no-op when nothing is due", () => {
    expect(pensionBenefitPayment({ benefitsDueAnchor: 0, cashAnchor: 500 })).toEqual({
      paidAnchor: 0,
      unpaidAnchor: 0,
      cutFraction: 0,
    });
    expect(
      pensionBenefitPayment({ benefitsDueAnchor: Number.NaN, cashAnchor: 500 }).paidAnchor
    ).toBe(0);
  });
});

describe("pensionInvestableCashAnchor", () => {
  it("keeps the cash floor back for a scheme with no pensioners yet", () => {
    // No benefits in payment, so the benefit buffer is zero and the flat floor
    // is the only thing standing between the scheme and full illiquidity.
    expect(
      pensionInvestableCashAnchor({ cashAnchor: 100_000, benefitsInPaymentAnchor: 0 })
    ).toBeCloseTo(90_000, 10);
  });

  it("reserves the documented number of turns of benefits", () => {
    // 500_000 in payment draws 10_000 a turn, so the buffer is 80_000.
    expect(
      pensionInvestableCashAnchor({ cashAnchor: 100_000, benefitsInPaymentAnchor: 500_000 })
    ).toBeCloseTo(20_000, 10);
  });

  it("invests nothing when the buffer already exceeds the cash", () => {
    expect(
      pensionInvestableCashAnchor({ cashAnchor: 50_000, benefitsInPaymentAnchor: 500_000 })
    ).toBe(0);
  });

  it("leaves enough behind that the buffered turns can all be paid in full", () => {
    const cash = 100_000;
    const inPayment = 300_000;
    let remaining =
      cash - pensionInvestableCashAnchor({ cashAnchor: cash, benefitsInPaymentAnchor: inPayment });
    // Worst case: not one more ₳ ever arrives from an employer.
    for (let turn = 0; turn < PENSION_LIQUIDITY_BUFFER_TURNS; turn += 1) {
      const payment = pensionBenefitPayment({
        benefitsDueAnchor: pensionBenefitsDueForTurn(inPayment),
        cashAnchor: remaining,
      });
      expect(payment.cutFraction).toBe(0);
      remaining -= payment.paidAnchor;
    }
  });

  it("does not bother for pocket change", () => {
    expect(pensionInvestableCashAnchor({ cashAnchor: 500, benefitsInPaymentAnchor: 0 })).toBe(0);
    expect(pensionInvestableCashAnchor({ cashAnchor: 0, benefitsInPaymentAnchor: 0 })).toBe(0);
    expect(
      pensionInvestableCashAnchor({ cashAnchor: Number.NaN, benefitsInPaymentAnchor: 0 })
    ).toBe(0);
  });

  it("never returns more than the cash the scheme holds", () => {
    for (const cash of [1000, 12_345, 1_000_000]) {
      expect(
        pensionInvestableCashAnchor({ cashAnchor: cash, benefitsInPaymentAnchor: 0 })
      ).toBeLessThan(cash);
    }
  });
});
