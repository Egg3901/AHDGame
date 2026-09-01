import { describe, expect, it } from "vitest";
import { governorOfficialFilter, officialsCountryScope } from "./electedOfficialScope";

describe("officialsCountryScope", () => {
  it("matches legacy untagged rows for the US", () => {
    // US officials predate the countryId field, so a plain equality filter
    // would drop rows that were simply never stamped.
    expect(officialsCountryScope("US")).toEqual({
      $or: [{ countryId: "US" }, { countryId: { $exists: false } }],
    });
  });

  it("uses plain equality for countries added after the field existed", () => {
    expect(officialsCountryScope("BR")).toEqual({ countryId: "BR" });
    expect(officialsCountryScope("UK")).toEqual({ countryId: "UK" });
  });

  it("always constrains the country, so an unscoped query is never produced", () => {
    // The bug this exists to prevent (#0699) is a filter that omits the country
    // entirely and matches a same-numbered party in another country.
    for (const countryId of ["US", "UK", "BR", "RU", "CN"] as const) {
      expect(Object.keys(officialsCountryScope(countryId)).length).toBeGreaterThan(0);
    }
  });
});

describe("governorOfficialFilter", () => {
  it("scopes a US governor to the state and tolerates an untagged row", () => {
    expect(governorOfficialFilter("US", "US_CA")).toEqual({
      officeType: "governor",
      state: "US_CA",
      $or: [{ countryId: "US" }, { countryId: { $exists: false } }],
    });
  });

  it("scopes a non-US regional executive by country and state", () => {
    expect(governorOfficialFilter("RU", "RU_TA")).toEqual({
      officeType: "governor",
      state: "RU_TA",
      countryId: "RU",
    });
  });
});
