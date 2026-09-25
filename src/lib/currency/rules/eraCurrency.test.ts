import { describe, expect, it } from "vitest";
import {
  currencyConversionScale,
  currencyForCountryAtYear,
  euroMembersAtYear,
} from "./eraCurrency";

describe("era currency topology", () => {
  it("uses EUR for every modeled euro member in 2027", () => {
    expect(euroMembersAtYear(2027).sort()).toEqual(
      ["AT", "DE", "ES", "FI", "FR", "GR", "IE", "IT"].sort()
    );
    expect(currencyForCountryAtYear("IE", 2027, "IEP")).toBe("EUR");
    expect(currencyForCountryAtYear("IT", 2027, "ITL")).toBe("EUR");
  });

  it("preserves legacy currencies before adoption and non-members after it", () => {
    expect(currencyForCountryAtYear("IE", 1991, "IEP")).toBe("IEP");
    expect(currencyForCountryAtYear("GR", 1999, "GRD")).toBe("GRD");
    expect(currencyForCountryAtYear("SE", 2027, "SEK")).toBe("SEK");
  });

  it("converts denominations without changing anchor value", () => {
    const legacyAmount = 1_000;
    const legacyRate = 10;
    const eurRate = 0.92;
    const converted = legacyAmount * currencyConversionScale(legacyRate, eurRate);
    expect(converted / eurRate).toBeCloseTo(legacyAmount / legacyRate, 10);
  });
});
