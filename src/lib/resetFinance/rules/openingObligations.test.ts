import { describe, expect, it } from "vitest";
import { fitOpeningObligations } from "./openingObligations";

describe("1991 opening obligation affordability", () => {
  const input = {
    revenue: 100,
    gdp: 1000,
    interest: 10,
    maximumDeficitGdpShare: 0.005,
    obligations: [
      { sourceId: "grant", annualAmount: 20, protectedTransfer: true },
      { sourceId: "pension", annualAmount: 60 },
      { sourceId: "education", annualAmount: 40 },
    ],
  };

  it("funds the named transfer first and resizes real programs within receipts after coupons", () => {
    const result = fitOpeningObligations(input);
    expect(result.sourceAllocations).toEqual({ grant: 20, pension: 45, education: 30 });
    expect(result.operating + input.interest - input.revenue).toBe(5);
    expect(result.programCostScale).toBe(0.75);
  });

  it("keeps affordable programs and rounds only down to whole native currency units", () => {
    expect(fitOpeningObligations({ ...input, revenue: 140 }).sourceAllocations).toEqual({
      grant: 20,
      pension: 60,
      education: 40,
    });
    const rounded = fitOpeningObligations({ ...input, revenue: 99 });
    expect(rounded.operating + input.interest - 99).toBeLessThanOrEqual(5);
    expect(Object.values(rounded.sourceAllocations).every(Number.isSafeInteger)).toBe(true);
  });

  it("fails closed on double ownership, invalid values or unaffordable locked obligations", () => {
    expect(() =>
      fitOpeningObligations({ ...input, obligations: [...input.obligations, input.obligations[0]] })
    ).toThrow("duplicate");
    expect(() => fitOpeningObligations({ ...input, revenue: Number.NaN })).toThrow("envelope");
    expect(() => fitOpeningObligations({ ...input, revenue: 5 })).toThrow("protected transfers");
    expect(() => fitOpeningObligations({ ...input, maximumDeficitGdpShare: -1 })).toThrow("share");
  });
});
