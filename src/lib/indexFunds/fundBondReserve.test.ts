import { describe, expect, it } from "vitest";
import { resolveFundBondCountryId } from "./fundBondReserve";

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
