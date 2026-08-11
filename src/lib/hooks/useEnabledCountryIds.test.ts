import { describe, expect, it } from "vitest";
import { parseEnabledCountryIds } from "./useEnabledCountryIds";

describe("parseEnabledCountryIds", () => {
  it("maps the /api/game/countries object response to uppercase CountryId[]", () => {
    // The route returns CountryCreationInfo[] with lowercase `id`.
    const data = {
      countries: [
        { id: "cn", name: "China" },
        { id: "us", name: "United States" },
        { id: "ie", name: "Ireland" },
      ],
    };
    expect(parseEnabledCountryIds(data)).toEqual(["CN", "US", "IE"]);
  });

  it("filters out ids that are not real countries", () => {
    const data = { countries: [{ id: "cn" }, { id: "atlantis" }, { id: "uk" }] };
    expect(parseEnabledCountryIds(data)).toEqual(["CN", "UK"]);
  });

  it("tolerates a legacy string[] response shape", () => {
    expect(parseEnabledCountryIds({ countries: ["US", "JP"] })).toEqual(["US", "JP"]);
  });

  it("returns [] for malformed or empty payloads", () => {
    expect(parseEnabledCountryIds(null)).toEqual([]);
    expect(parseEnabledCountryIds({})).toEqual([]);
    expect(parseEnabledCountryIds({ countries: "nope" })).toEqual([]);
    expect(parseEnabledCountryIds({ countries: [{ name: "no id" }, 42, null] })).toEqual([]);
  });
});
