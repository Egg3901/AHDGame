import { describe, expect, it } from "vitest";
import { corpLevelDailyCosts } from "./corpLevelDailyCosts";

describe("corpLevelDailyCosts", () => {
  it("sums marketing, logistics, R&D and CEO salary", () => {
    expect(
      corpLevelDailyCosts({
        marketingBudget: 10,
        logisticsBudget: 20,
        rdBudget: 30,
        ceoSalary: 40,
      })
    ).toBe(100);
  });

  it("includes the R&D budget, which the exchange snapshot used to omit", () => {
    const withoutRd = corpLevelDailyCosts({ marketingBudget: 10, rdBudget: 0 });
    const withRd = corpLevelDailyCosts({ marketingBudget: 10, rdBudget: 250 });
    expect(withRd - withoutRd).toBe(250);
  });

  it("treats missing lines as zero", () => {
    expect(corpLevelDailyCosts({ marketingBudget: 10 })).toBe(10);
    expect(corpLevelDailyCosts({})).toBe(0);
  });

  it("ignores a non-finite line rather than propagating NaN", () => {
    expect(corpLevelDailyCosts({ marketingBudget: 10, rdBudget: Number.NaN })).toBe(10);
  });
});
