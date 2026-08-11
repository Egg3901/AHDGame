import { describe, expect, it } from "vitest";
import {
  readGovBudgetAnchor,
  resolveCountryCurrencyCode,
  writeGovBudgetLocal,
} from "./govBudgetFields";

describe("resolveCountryCurrencyCode", () => {
  it("returns the explicit currencyCode when present and non-empty", () => {
    expect(resolveCountryCurrencyCode({ currencyCode: "GBP" })).toBe("GBP");
    expect(resolveCountryCurrencyCode({ countryId: "US", currencyCode: "JPY" })).toBe("JPY");
  });

  it("falls back to COUNTRY_CURRENCY_MAP when currencyCode is missing or blank", () => {
    expect(resolveCountryCurrencyCode({ countryId: "UK" })).toBe("GBP");
    expect(resolveCountryCurrencyCode({ countryId: "JP" })).toBe("JPY");
    expect(resolveCountryCurrencyCode({ countryId: "US" })).toBe("USD");
    expect(resolveCountryCurrencyCode({ countryId: "DE" })).toBe("EUR");
    expect(resolveCountryCurrencyCode({ countryId: "UK", currencyCode: "" })).toBe("GBP");
    expect(resolveCountryCurrencyCode({ countryId: "UK", currencyCode: null })).toBe("GBP");
    expect(resolveCountryCurrencyCode({ countryId: "UK", currencyCode: "   " })).toBe("GBP");
  });

  it("returns undefined when neither currencyCode nor valid countryId is present", () => {
    expect(resolveCountryCurrencyCode({})).toBeUndefined();
    expect(resolveCountryCurrencyCode(null)).toBeUndefined();
    expect(resolveCountryCurrencyCode(undefined)).toBeUndefined();
    expect(resolveCountryCurrencyCode({ countryId: "XX" })).toBeUndefined();
  });
});

describe("govBudgetFields read/write", () => {
  it("passes values through unchanged when currencyCode is missing (pre-forex budget)", () => {
    expect(readGovBudgetAnchor(100, undefined, 0.5)).toBe(100);
    expect(writeGovBudgetLocal(100, undefined, 0.5)).toBe(100);
  });

  it("divides local by rate to recover anchor", () => {
    expect(readGovBudgetAnchor(200, "GBP", 0.5)).toBe(400);
  });

  it("multiplies anchor by rate to express in country currency", () => {
    expect(writeGovBudgetLocal(400, "GBP", 0.5)).toBe(200);
    expect(writeGovBudgetLocal(100, "JPY", 100)).toBe(10_000);
  });

  it("round-trips anchor → local → anchor at rate=1", () => {
    const anchor = 9_876_543.21;
    const local = writeGovBudgetLocal(anchor, "USD", 1);
    expect(readGovBudgetAnchor(local, "USD", 1)).toBe(anchor);
  });

  it("round-trips anchor → local → anchor at rate=2", () => {
    const anchor = 1_000_000;
    const local = writeGovBudgetLocal(anchor, "GBP", 2);
    expect(local).toBe(2_000_000);
    expect(readGovBudgetAnchor(local, "GBP", 2)).toBe(anchor);
  });

  it("passes values through on non-positive or non-finite rate", () => {
    expect(readGovBudgetAnchor(100, "USD", 0)).toBe(100);
    expect(readGovBudgetAnchor(100, "USD", -1)).toBe(100);
    expect(readGovBudgetAnchor(100, "USD", Number.NaN)).toBe(100);
    expect(writeGovBudgetLocal(100, "USD", 0)).toBe(100);
    expect(writeGovBudgetLocal(100, "USD", Number.NaN)).toBe(100);
  });

  it("handles zero values cleanly in both directions", () => {
    expect(readGovBudgetAnchor(0, "GBP", 2)).toBe(0);
    expect(writeGovBudgetLocal(0, "GBP", 2)).toBe(0);
  });
});
