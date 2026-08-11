import { describe, it, expect } from "vitest";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  anchorToCorpCapital,
  anchorToCorpLiquidCapital,
  corpCapitalToAnchor,
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  resolveCorpLiquidCurrencyCode,
} from "./corporationCapital";

describe("anchorToCorpCapital", () => {
  it("returns the amount unchanged for pre-forex corps (no liquidCurrencyCode)", () => {
    expect(anchorToCorpCapital(1000, undefined, 106)).toBe(1000);
    expect(anchorToCorpCapital(1000, null, 106)).toBe(1000);
  });

  it("multiplies by FX rate for USD (USD floats against ₳ under forex)", () => {
    expect(anchorToCorpCapital(1000, "USD", 0.8877)).toBe(887.7);
    expect(anchorToCorpCapital(1000, "USD", 1.0)).toBe(1000);
  });

  it("multiplies by FX rate for non-USD home currencies", () => {
    expect(anchorToCorpCapital(1000, "JPY", 106)).toBe(106_000);
    expect(anchorToCorpCapital(1000, "GBP", 0.75)).toBe(750);
  });

  it("falls back to the raw amount if the FX rate is invalid", () => {
    expect(anchorToCorpCapital(1000, "JPY", 0)).toBe(1000);
    expect(anchorToCorpCapital(1000, "JPY", -5)).toBe(1000);
    expect(anchorToCorpCapital(1000, "JPY", Number.NaN)).toBe(1000);
  });
});

describe("corpCapitalToAnchor", () => {
  it("is the inverse of anchorToCorpCapital for non-USD corps", () => {
    const original = 41_400_000; // ₳
    const asLocal = anchorToCorpCapital(original, "JPY", 106);
    expect(corpCapitalToAnchor(asLocal, "JPY", 106)).toBeCloseTo(original);
  });

  it("is the inverse of anchorToCorpCapital for USD corps", () => {
    const original = 500_000; // ₳
    const asLocal = anchorToCorpCapital(original, "USD", 0.8877);
    expect(corpCapitalToAnchor(asLocal, "USD", 0.8877)).toBeCloseTo(original);
  });

  it("returns the amount unchanged for pre-forex corps", () => {
    expect(corpCapitalToAnchor(500_000, undefined, 106)).toBe(500_000);
  });

  it("divides by FX rate for USD (USD floats against ₳ under forex)", () => {
    // 420,223 USD at rate 0.8877 (USD per ₳) ≈ 473,384 ₳
    expect(corpCapitalToAnchor(420_223, "USD", 0.8877)).toBeCloseTo(473_384.03, 0);
    expect(corpCapitalToAnchor(500_000, "USD", 1.0)).toBe(500_000);
  });

  it("divides by FX rate for non-USD home currencies", () => {
    expect(corpCapitalToAnchor(750, "GBP", 0.75)).toBe(1000);
    expect(corpCapitalToAnchor(106_000, "JPY", 106)).toBe(1000);
  });

  it("falls back to the raw amount if the FX rate is invalid", () => {
    expect(corpCapitalToAnchor(1000, "JPY", 0)).toBe(1000);
    expect(corpCapitalToAnchor(1000, "JPY", -5)).toBe(1000);
  });
});

describe("resolveCorpLiquidCurrencyCode", () => {
  it("prefers explicit liquidCurrencyCode when set", () => {
    expect(resolveCorpLiquidCurrencyCode({ liquidCurrencyCode: "JPY", countryId: "US" })).toBe(
      "JPY"
    );
  });

  it("infers from countryId when liquidCurrencyCode is absent", () => {
    expect(resolveCorpLiquidCurrencyCode({ countryId: "JP" })).toBe("JPY");
    expect(resolveCorpLiquidCurrencyCode({ countryId: "UK" })).toBe("GBP");
  });

  it("returns undefined when there is no explicit code and no mappable country", () => {
    expect(resolveCorpLiquidCurrencyCode({})).toBeUndefined();
  });
});

describe("fxRateForCorpFromMap", () => {
  const fullMap = new Map<CurrencyCode, number>([
    ["JPY", 106],
    ["USD", 0.8877],
    ["GBP", 0.75],
  ]);

  it("returns 1 only when no currency code can be resolved", () => {
    expect(fxRateForCorpFromMap({}, fullMap)).toBe(1);
  });

  it("looks up USD via the live map (USD floats under forex)", () => {
    expect(fxRateForCorpFromMap({ liquidCurrencyCode: "USD" }, fullMap)).toBe(0.8877);
    expect(fxRateForCorpFromMap({ countryId: "US" }, fullMap)).toBe(0.8877);
  });

  it("resolves rate by liquidCurrencyCode or country fallback", () => {
    expect(fxRateForCorpFromMap({ liquidCurrencyCode: "JPY" }, fullMap)).toBe(106);
    expect(fxRateForCorpFromMap({ countryId: "JP" }, fullMap)).toBe(106);
  });

  it("falls back to 1 when the currency is missing from the map", () => {
    const empty = new Map<CurrencyCode, number>();
    expect(fxRateForCorpFromMap({ liquidCurrencyCode: "JPY" }, empty)).toBe(1);
    expect(fxRateForCorpFromMap({ liquidCurrencyCode: "USD" }, empty)).toBe(1);
  });
});

describe("anchorToCorpLiquidCapital / corpLiquidCapitalToAnchor", () => {
  it("converts using country when liquidCurrencyCode is missing (matches issuance / API paths)", () => {
    const corp = { countryId: "JP" as const };
    expect(anchorToCorpLiquidCapital(1000, corp, 106)).toBe(106_000);
    expect(corpLiquidCapitalToAnchor(106_000, corp, 106)).toBeCloseTo(1000);
  });
});
