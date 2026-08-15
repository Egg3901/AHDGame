import { describe, expect, it } from "vitest";
import { corpIncomeBasis } from "@/components/corporation/financials/financialsModel";
import type { Financials } from "@/components/corporation/CorporationPageTypes";
import { bondIssueIncomePreview } from "./bondIssueIncomePreview";

/**
 * Ticket #1109: the Issue Bond "Income after" preview used projected
 * `income - dividendDistribution` instead of the realized retained figure
 * every other corp surface reads. A nameplate-heavy corp (extraction haircut,
 * etc.) then looked profitable after a coupon that would actually drain cash.
 *
 * Worked example: ₳10M face at 5% costs ₳500,000/yr = ₳250,000/financial-day.
 * Realized retained ₳36,000/day ($1,500/turn) cannot cover that. The old
 * projected leftover (₳772,728 income − ₳154,546 dividend = ₳618,182) could.
 */
const FACE = 10_000_000;
const COUPON_PCT = 5;

const projectedFinancials = {
  income: 772_728,
  realizedIncome: 36_000,
  realizedDividendPaid: 0,
  dividendDistribution: 154_546,
} as Pick<
  Financials,
  "income" | "realizedIncome" | "realizedDividendPaid" | "dividendDistribution"
>;

describe("bondIssueIncomePreview (ticket #1109)", () => {
  it("costs ₳250,000 per financial day on a ₳10M 5% bond", () => {
    const preview = bondIssueIncomePreview({
      retainedDaily: 36_000,
      couponRatePercent: COUPON_PCT,
      faceValue: FACE,
    });
    expect(preview.annualCost).toBe(500_000);
    expect(preview.dailyCost).toBe(250_000);
  });

  it("reports a loss per turn when realized retained cannot cover the coupon", () => {
    const preview = bondIssueIncomePreview({
      retainedDaily: 36_000,
      couponRatePercent: COUPON_PCT,
      faceValue: FACE,
    });
    expect(preview.incomeBeforePerTurn).toBe(1_500);
    expect(preview.incomeAfterPerTurn).toBeCloseTo(-8_916.6667, 4);
    expect(preview.staysProfitable).toBe(false);
  });

  it("does not treat the leftover projected-minus-dividend figure as still profitable", () => {
    const oldPreviewRetained =
      projectedFinancials.income - projectedFinancials.dividendDistribution;
    const lied = bondIssueIncomePreview({
      retainedDaily: oldPreviewRetained,
      couponRatePercent: COUPON_PCT,
      faceValue: FACE,
    });
    expect(lied.staysProfitable).toBe(true);

    const realizedRetained = corpIncomeBasis(projectedFinancials).retained;
    const honest = bondIssueIncomePreview({
      retainedDaily: realizedRetained,
      couponRatePercent: COUPON_PCT,
      faceValue: FACE,
    });
    expect(realizedRetained).toBe(36_000);
    expect(honest.staysProfitable).toBe(false);
  });

  it("stays profitable when realized retained actually covers the coupon", () => {
    const preview = bondIssueIncomePreview({
      retainedDaily: 300_000,
      couponRatePercent: COUPON_PCT,
      faceValue: FACE,
    });
    expect(preview.staysProfitable).toBe(true);
    expect(preview.incomeAfterPerTurn).toBeCloseTo(2_083.3333, 4);
  });
});
