import { describe, expect, it } from "vitest";
import { fitOpeningFiscalEnvelope } from "./openingFiscalEnvelope";

describe("opening fiscal envelope", () => {
  it("funds historic coupons first and reduces programs in proportion", () => {
    const result = fitOpeningFiscalEnvelope({
      gdp: 1_000,
      annualRevenue: 200,
      annualDebtService: 40,
      byCategory: { healthcare: 120, education: 60 },
      stateGrants: 60,
      maximumDeficitGdpShare: 0.005,
    });
    expect(result).toEqual({ byCategory: { healthcare: 82, education: 41 }, stateGrants: 41 });
    expect(
      Object.values(result.byCategory).reduce((sum, value) => sum + value, 0) +
        result.stateGrants +
        40
    ).toBeLessThanOrEqual(205);
  });

  it("retains an already affordable budget and handles an empty program book", () => {
    const input = {
      gdp: 1_000,
      annualRevenue: 200,
      annualDebtService: 40,
      byCategory: { healthcare: 100 },
      stateGrants: 20,
      maximumDeficitGdpShare: 0.005,
    };
    expect(fitOpeningFiscalEnvelope(input)).toEqual({
      byCategory: input.byCategory,
      stateGrants: 20,
    });
    expect(fitOpeningFiscalEnvelope({ ...input, byCategory: {}, stateGrants: 0 })).toEqual({
      byCategory: {},
      stateGrants: 0,
    });
  });
});
