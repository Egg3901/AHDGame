import { describe, expect, it } from "vitest";
import { bondAllocationBudgetForIssue, resolveFundBondCountryId } from "./fundBondReserve";

describe("resolveFundBondCountryId", () => {
  it("uses the fund country when present", () => {
    expect(
      resolveFundBondCountryId({
        countryId: "UK",
        anchorCurrencyCode: "GBP",
        scope: "country",
      })
    ).toBe("UK");
  });

  it("maps USD anchor global funds to US sovereign paper", () => {
    expect(
      resolveFundBondCountryId({
        anchorCurrencyCode: "USD",
        scope: "global",
      })
    ).toBe("US");
  });
});

describe("bondAllocationBudgetForIssue", () => {
  it("spreads remaining cash equally across the remaining auction issues", () => {
    expect(bondAllocationBudgetForIssue(10_000_000, 25)).toBe(400_000);
    expect(bondAllocationBudgetForIssue(9_600_000, 24)).toBe(400_000);
  });

  it("returns zero for an exhausted budget or issue list", () => {
    expect(bondAllocationBudgetForIssue(0, 25)).toBe(0);
    expect(bondAllocationBudgetForIssue(10_000_000, 0)).toBe(0);
  });
});
