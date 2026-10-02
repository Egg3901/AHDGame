import { describe, expect, it } from "vitest";
import { activePartyNppFilter } from "./recruitmentScope";

describe("activePartyNppFilter", () => {
  it.each(["UK", "DD", "AT"] as const)(
    "strictly isolates %s from foreign and untagged NPPs",
    (countryId) => {
      expect(activePartyNppFilter(countryId, "10")).toEqual({
        countryId,
        party: "10",
        retiredAt: null,
      });
    }
  );

  it("preserves the missing-country US legacy convention", () => {
    expect(activePartyNppFilter("US", "10")).toEqual({
      $or: [{ countryId: "US" }, { countryId: { $exists: false } }],
      party: "10",
      retiredAt: null,
    });
  });

  it("constrains regional slots without constraining national totals", () => {
    expect(activePartyNppFilter("UK", "10", "SCO")).toEqual({
      countryId: "UK",
      party: "10",
      retiredAt: null,
      homeState: "SCO",
    });
    expect(activePartyNppFilter("US", "10", "CA")).toMatchObject({ homeState: "CA" });
    expect(activePartyNppFilter("US", "10")).not.toHaveProperty("homeState");
  });
});
