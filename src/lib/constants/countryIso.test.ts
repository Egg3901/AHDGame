import { describe, it, expect } from "vitest";
import {
  ISO_NUMERIC_TO_COUNTRY,
  COUNTRY_TO_ISO_NUMERIC,
  isoNumericToCountryId,
} from "./countryIso";

describe("isoNumericToCountryId", () => {
  it("maps known ISO-numeric codes to CountryId", () => {
    expect(isoNumericToCountryId("840")).toBe("US");
    expect(isoNumericToCountryId("276")).toBe("DE");
    expect(isoNumericToCountryId("566")).toBe("NG");
  });
  it("returns undefined for unmapped codes", () => {
    expect(isoNumericToCountryId("999")).toBeUndefined();
  });
  it("round-trips through COUNTRY_TO_ISO_NUMERIC", () => {
    for (const [iso, country] of Object.entries(ISO_NUMERIC_TO_COUNTRY)) {
      expect(COUNTRY_TO_ISO_NUMERIC[country]).toBe(iso);
    }
  });
});
