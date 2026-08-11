import { describe, expect, it } from "vitest";
import { nationalDebtFromBalance, deriveFiscalState } from "./treasuryBalance";

describe("nationalDebtFromBalance", () => {
  it("is 0 when the balance is positive (savings)", () => {
    expect(nationalDebtFromBalance(5_000)).toBe(0);
  });
  it("is the magnitude of a negative balance (debt)", () => {
    expect(nationalDebtFromBalance(-12_000)).toBe(12_000);
  });
});

describe("deriveFiscalState", () => {
  it("derives principal, debt-to-GDP, rating, rate, ceiling from a negative balance", () => {
    const s = deriveFiscalState({
      treasuryBalance: -50,
      gdp: 100,
      ceiling: 40,
      investorConfidence: 70,
    });
    expect(s.principal).toBe(50);
    expect(s.debtToGdpRatio).toBeCloseTo(0.5, 5);
    expect(s.ceilingExceeded).toBe(true); // 50 > 40
    expect(typeof s.interestRate).toBe("number");
    expect(s.creditRating).toBeDefined();
  });
  it("a positive balance has zero debt and is under any ceiling", () => {
    const s = deriveFiscalState({
      treasuryBalance: 1_000,
      gdp: 100,
      ceiling: 40,
      investorConfidence: 70,
    });
    expect(s.principal).toBe(0);
    expect(s.debtToGdpRatio).toBe(0);
    expect(s.ceilingExceeded).toBe(false);
  });

  it("uses gdpSmoothed for the debt ratio when present (default-stability guard)", () => {
    // raw gdp swung to 100 but smoothed sits at 200 → ratio uses 200, not 100
    const s = deriveFiscalState({
      treasuryBalance: -50,
      gdp: 100,
      gdpSmoothed: 200,
      ceiling: 40,
    });
    expect(s.debtToGdpRatio).toBeCloseTo(0.25, 5); // 50 / 200, not 50 / 100
  });

  it("falls back to raw gdp when gdpSmoothed is absent or non-positive", () => {
    const s = deriveFiscalState({ treasuryBalance: -50, gdp: 100, ceiling: 40 });
    expect(s.debtToGdpRatio).toBeCloseTo(0.5, 5); // 50 / 100
  });

  it("preserves an authored historical risk regime and reprices deterioration", () => {
    const sovereignRiskAnchor = {
      debtToGdpRatio: 1.8,
      creditRating: "AAA" as const,
      interestRate: 0.04,
    };
    const seeded = deriveFiscalState({
      treasuryBalance: -180,
      gdp: 100,
      ceiling: 250,
      sovereignRiskAnchor,
    });
    expect(seeded.creditRating).toBe("AAA");
    expect(seeded.interestRate).toBeCloseTo(0.04, 8);

    const deteriorated = deriveFiscalState({
      treasuryBalance: -252,
      gdp: 100,
      ceiling: 300,
      sovereignRiskAnchor,
    });
    expect(deteriorated.creditRating).toBe("AA");
    expect(deteriorated.interestRate).toBeCloseTo(0.05, 8);
  });
});
