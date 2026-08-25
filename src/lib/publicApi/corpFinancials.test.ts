import { describe, expect, it } from "vitest";
import { corpFinancials } from "./corpFinancials";

const noFx = new Map<string, number>();

describe("corpFinancials", () => {
  it("reports realized revenue, not the nameplate", () => {
    const f = corpFinancials({
      sectors: [{ _id: "s1", revenue: 1000, realizedRevenue: 250, effectiveProfitMargin: 40 }],
      hostRateBySectorId: noFx,
    });
    expect(f.totalRevenue).toBe(250);
  });

  it("reports a fully embargoed sector as zero, not as its nameplate", () => {
    const f = corpFinancials({
      sectors: [{ _id: "s1", revenue: 1000, realizedRevenue: 0, effectiveProfitMargin: 40 }],
      hostRateBySectorId: noFx,
    });
    expect(f.totalRevenue).toBe(0);
  });

  it("uses effectiveProfitMargin, the engine-applied margin", () => {
    const f = corpFinancials({
      sectors: [
        {
          _id: "s1",
          revenue: 100,
          realizedRevenue: 100,
          profitMargin: 10,
          effectiveProfitMargin: 40,
        },
      ],
      hostRateBySectorId: noFx,
    });
    expect(f.operatingIncome).toBe(40);
  });

  it("falls back to the CEO-set margin when no effective margin was written", () => {
    const f = corpFinancials({
      sectors: [{ _id: "s1", revenue: 100, realizedRevenue: 100, profitMargin: 10 }],
      hostRateBySectorId: noFx,
    });
    expect(f.operatingIncome).toBe(10);
  });

  it("converts each sector from its host currency before summing", () => {
    // Sector b earns in a currency worth 1/10th. A raw sum would read 200;
    // the correct anchored total is 110.
    const f = corpFinancials({
      sectors: [
        { _id: "a", revenue: 100, realizedRevenue: 100, effectiveProfitMargin: 0 },
        { _id: "b", revenue: 100, realizedRevenue: 100, effectiveProfitMargin: 0 },
      ],
      hostRateBySectorId: new Map([
        ["a", 1],
        ["b", 10],
      ]),
    });
    expect(f.totalRevenue).toBe(110);
  });

  it("treats a missing or non-positive host rate as 1 rather than dividing by zero", () => {
    const f = corpFinancials({
      sectors: [{ _id: "a", revenue: 50, realizedRevenue: 50, effectiveProfitMargin: 0 }],
      hostRateBySectorId: new Map([["a", 0]]),
    });
    expect(f.totalRevenue).toBe(50);
  });

  it("derives operating costs as revenue minus income", () => {
    const f = corpFinancials({
      sectors: [{ _id: "s1", revenue: 100, realizedRevenue: 100, effectiveProfitMargin: 30 }],
      hostRateBySectorId: noFx,
    });
    expect(f.operatingCosts).toBe(70);
  });

  it("returns zeroes for a corporation with no sectors", () => {
    const f = corpFinancials({ sectors: [], hostRateBySectorId: noFx });
    expect(f).toEqual({ totalRevenue: 0, operatingIncome: 0, operatingCosts: 0 });
  });
});
