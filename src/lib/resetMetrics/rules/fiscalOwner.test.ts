import { describe, expect, it } from "vitest";
import { fiscalOwnerReadings } from "./fiscalOwner";

describe("v2 national fiscal owners", () => {
  it("uses current revenue and spending, not a stale surplus field", () => {
    expect(
      fiscalOwnerReadings({
        gdp: 1000,
        revenue: 90,
        spending: 100,
        debtPrincipal: 500,
        inflationRate: 4,
      })
    ).toEqual({ priceChange: 4, balanceToGdp: -1, debtToGdp: 50 });
  });

  it("withholds an unsupported ratio instead of treating missing totals as zero", () => {
    expect(fiscalOwnerReadings({ gdp: 0, revenue: 90, spending: 100 })).toEqual({
      priceChange: null,
      balanceToGdp: null,
      debtToGdp: null,
    });
    expect(fiscalOwnerReadings({ gdp: 1000, revenue: 90, debtPrincipal: -2 })).toEqual({
      priceChange: null,
      balanceToGdp: null,
      debtToGdp: null,
    });
  });
});
