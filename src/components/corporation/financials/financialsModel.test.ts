import { describe, it, expect } from "vitest";
import {
  scaleToPeriod,
  netMarginPct,
  valuation,
  buildAllocation,
  corpIncomeBasis,
} from "./financialsModel";
import type { Financials } from "../CorporationPageTypes";

const baseFinancials: Financials = {
  totalRevenue: 2400,
  maintenanceCosts: 480,
  laborCosts: 0,
  growthCosts: 240,
  marketingCosts: 120,
  logisticsCosts: 0,
  rdCosts: 0,
  ceoSalaryCost: 0,
  pensionContributionCost: 0,
  pensionTopUpCost: 0,
  pensionSchemesInDeficit: 0,
  operatingCosts: 840,
  operatingIncome: 1560,
  federalTax: 360,
  stateTax: 0,
  federalTaxByCountry: {},
  bondInterestCost: 0,
  bondCouponIncome: 0,
  dividendIncomeReceived: 0,
  governmentBondSubsidy: 0,
  imfFacilityPaymentDaily: 0,
  imfFacilityReceiptsDaily: 0,
  totalCosts: 1200,
  income: 1200,
  dividendRate: 0,
  effectiveDividendRate: 0,
  dividendDistribution: 0,
  regulatoryBurden: 0,
  currentGrowthRate: 0,
  subsidyBenefit: 0,
};

describe("scaleToPeriod", () => {
  it("divides by 24 for hourly", () => {
    expect(scaleToPeriod(2400, "turn")).toBe(100);
  });
  it("multiplies by 2 for annual", () => {
    expect(scaleToPeriod(2400, "annual")).toBe(4800);
  });
});

describe("netMarginPct", () => {
  it("computes income over revenue as a percent", () => {
    expect(
      netMarginPct({
        income: 1200,
        totalRevenue: 2400,
        bondCouponIncome: 0,
        imfFacilityReceiptsDaily: 0,
      })
    ).toBe(50);
  });
  it("returns 0 when the total income base is non-positive", () => {
    expect(
      netMarginPct({
        income: 100,
        totalRevenue: 0,
        bondCouponIncome: 0,
        imfFacilityReceiptsDaily: 0,
      })
    ).toBe(0);
  });
  it("counts bond coupon income in the denominator so bond-heavy corps stay under 100%", () => {
    // Operating revenue 1.7M, coupon 3.1M, net income 3.3M — the raw
    // income/revenue ratio was 194% (support #941); against total income
    // taken in it lands at a sane ~63%.
    expect(
      netMarginPct({
        income: 3_300_000,
        totalRevenue: 1_700_000,
        bondCouponIncome: 3_100_000,
        imfFacilityReceiptsDaily: 0,
      })
    ).toBeCloseTo(68.75, 1);
  });
});

describe("valuation", () => {
  it("flags overvalued above 1.1x", () => {
    expect(valuation(220, 100)).toMatchObject({ tone: "over", label: "Overvalued" });
  });
  it("flags undervalued below 0.9x", () => {
    expect(valuation(80, 100)).toMatchObject({ tone: "under", label: "Undervalued" });
  });
  it("flags fairly valued in the band", () => {
    expect(valuation(100, 100)).toMatchObject({ tone: "fair", label: "Fairly valued" });
  });
  it("treats non-positive book value as fair / ratio 0 (no false 'undervalued')", () => {
    expect(valuation(100, 0)).toMatchObject({ tone: "fair", ratio: 0 });
  });
});

describe("buildAllocation", () => {
  it("scales revenue and net income to the period", () => {
    const a = buildAllocation(baseFinancials, "turn");
    expect(a.revenue).toBe(100);
    expect(a.netIncome).toBe(50);
  });
  it("emits one segment per non-zero cost, as a percent of gross revenue", () => {
    const a = buildAllocation(baseFinancials, "turn");
    const byKey = Object.fromEntries(a.segments.map((s) => [s.key, s]));
    expect(byKey.maintenance.pct).toBe(20); // 480/2400
    expect(byKey.growth.pct).toBe(10); // 240/2400
    expect(byKey.marketing.pct).toBe(5); // 120/2400
    expect(byKey.tax.pct).toBe(15); // 360/2400
    expect(byKey.interest).toBeUndefined(); // zero -> omitted
    expect(a.netPct).toBe(50);
  });
  it("nets interest in/out and omits when non-positive", () => {
    const withCoupon = { ...baseFinancials, bondCouponIncome: 1000 };
    const a = buildAllocation(withCoupon, "turn");
    expect(a.segments.find((s) => s.key === "interest")).toBeUndefined();
  });
  it("degrades gracefully on zero revenue", () => {
    const a = buildAllocation({ ...baseFinancials, totalRevenue: 0 }, "turn");
    expect(a.revenue).toBe(0);
    a.segments.forEach((s) => expect(s.pct).toBe(0));
  });
});

describe("corpIncomeBasis (ticket #1098)", () => {
  it("never subtracts the projected dividend from the realized income", () => {
    // Corp 484's shape: a profitable corp mid-build whose PROJECTED income runs
    // far ahead of what the engine actually booked. The old masthead computed
    // realizedIncome - dividendDistribution = 132_456 - 154_546 and reported a
    // loss while the Financials page reported a profit.
    const f: Financials = {
      ...baseFinancials,
      income: 772_728,
      realizedIncome: 132_456,
      realizedDividendPaid: 65_904,
      dividendDistribution: 154_546,
      effectiveDividendRate: 20,
      bondCouponIncome: 205_489,
      bondInterestCost: 381_655,
      dividendIncomeReceived: 648,
    };
    const basis = corpIncomeBasis(f);
    expect(basis.isRealized).toBe(true);
    // Retained is the realized figure as booked — already net of the payout.
    expect(basis.retained).toBe(132_456);
    expect(basis.retained).toBeGreaterThan(0);
    // Headline adds the dividends actually paid back to reach pre-dividend net.
    expect(basis.netIncome).toBe(132_456 + 65_904);
    expect(basis.dividendPaid).toBe(65_904);
  });

  it("does not double-count bond coupons already folded into realized income", () => {
    const f: Financials = {
      ...baseFinancials,
      income: 500,
      realizedIncome: 1_000,
      realizedDividendPaid: 0,
      bondCouponIncome: 900,
      dividendIncomeReceived: 100,
    };
    // The headline IS the realized figure; coupons are inside it, not on top.
    expect(corpIncomeBasis(f).netIncome).toBe(1_000);
  });

  it("falls back to the projection and nets its dividend for corps with no history", () => {
    const f: Financials = { ...baseFinancials, income: 1_200, dividendDistribution: 300 };
    const basis = corpIncomeBasis(f);
    expect(basis.isRealized).toBe(false);
    expect(basis.netIncome).toBe(1_200);
    expect(basis.retained).toBe(900);
  });

  it("treats a missing realizedDividendPaid as zero rather than NaN", () => {
    const f: Financials = { ...baseFinancials, realizedIncome: -250, dividendDistribution: 400 };
    const basis = corpIncomeBasis(f);
    expect(basis.netIncome).toBe(-250);
    expect(basis.retained).toBe(-250);
  });
});
