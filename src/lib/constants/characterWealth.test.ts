import { describe, expect, it } from "vitest";
import {
  WEALTH_BONUS,
  convertStartingAnchorToLocal,
  buildWealthOptions,
  resolveStartingCurrency,
} from "./characterWealth";

describe("WEALTH_BONUS", () => {
  it("holds the anchor-denominated starting cash for each tier", () => {
    expect(WEALTH_BONUS).toEqual({ low: 1_000_000, middle: 2_500_000, high: 5_000_000 });
  });
});

describe("convertStartingAnchorToLocal", () => {
  it("returns the anchor amount unchanged for the US (rate 1.0)", () => {
    expect(convertStartingAnchorToLocal(250_000, "US")).toBe(250_000);
  });

  it("converts to the home currency using the country's initial rate", () => {
    // CN initial rate 7.2
    expect(convertStartingAnchorToLocal(250_000, "CN")).toBe(1_800_000);
    // DE initial rate 0.92
    expect(convertStartingAnchorToLocal(250_000, "DE")).toBe(230_000);
    // JP initial rate 106.0
    expect(convertStartingAnchorToLocal(250_000, "JP")).toBe(26_500_000);
  });

  it("accepts country codes in any casing", () => {
    expect(convertStartingAnchorToLocal(250_000, "cn")).toBe(1_800_000);
  });

  it("falls back to the anchor amount (USD parity) for unknown/empty country", () => {
    expect(convertStartingAnchorToLocal(250_000, "")).toBe(250_000);
    expect(convertStartingAnchorToLocal(250_000, undefined)).toBe(250_000);
    expect(convertStartingAnchorToLocal(250_000, "ZZ")).toBe(250_000);
  });

  it("rounds the converted result", () => {
    // 1,000,000 * 0.92 = 920,000 (already integer); use a value that needs rounding
    expect(convertStartingAnchorToLocal(333_333, "DE")).toBe(Math.round(333_333 * 0.92));
  });
});

describe("buildWealthOptions", () => {
  it("defaults to USD ($) labels when no country is selected", () => {
    expect(buildWealthOptions()).toEqual([
      { value: "low", label: "Low Income - $1,000,000" },
      { value: "middle", label: "Middle Income - $2,500,000" },
      { value: "high", label: "High Income - $5,000,000" },
    ]);
  });

  it("defaults to USD ($) labels for an empty country string", () => {
    expect(buildWealthOptions("")).toEqual([
      { value: "low", label: "Low Income - $1,000,000" },
      { value: "middle", label: "Middle Income - $2,500,000" },
      { value: "high", label: "High Income - $5,000,000" },
    ]);
  });

  it("renders China amounts in CNY (¥) at the initial rate", () => {
    expect(buildWealthOptions("cn")).toEqual([
      { value: "low", label: "Low Income - ¥7,200,000" },
      { value: "middle", label: "Middle Income - ¥18,000,000" },
      { value: "high", label: "High Income - ¥36,000,000" },
    ]);
  });

  it("renders Germany amounts in EUR (€) at the initial rate", () => {
    expect(buildWealthOptions("de")).toEqual([
      { value: "low", label: "Low Income - €920,000" },
      { value: "middle", label: "Middle Income - €2,300,000" },
      { value: "high", label: "High Income - €4,600,000" },
    ]);
  });

  it("renders Ireland amounts in IEP (IR£), distinct from Germany's euro", () => {
    expect(buildWealthOptions("ie")).toEqual([
      { value: "low", label: "Low Income - IR£920,000" },
      { value: "middle", label: "Middle Income - IR£2,300,000" },
      { value: "high", label: "High Income - IR£4,600,000" },
    ]);
  });
});

describe("world currency basis", () => {
  it("uses stored 1953 rates for endowments and previews", () => {
    const rates = { NGN: 0.357, JPY: 360 };
    expect(convertStartingAnchorToLocal(1000, "NG", rates)).toBe(357);
    expect(convertStartingAnchorToLocal(1000, "jp", rates)).toBe(360000);
    expect(buildWealthOptions("NG", rates)[0].label).toContain("357,000");
  });
});

describe("euro preset handling (#2291)", () => {
  // A 2027 world seeds EUR rows; the legacy FRF row does not exist there.
  const euroWorldRates = { EUR: 0.92, FRF: 4.2 };

  it("prices a 2027 euro member in EUR at the EUR rate", () => {
    expect(resolveStartingCurrency("FR", euroWorldRates, "2027-default")).toEqual({
      currencyCode: "EUR",
      rate: 0.92,
    });
    expect(convertStartingAnchorToLocal(250_000, "FR", euroWorldRates, "2027-default")).toBe(
      Math.round(250_000 * 0.92)
    );
  });

  it("keeps the legacy code and rate when no preset is given", () => {
    expect(resolveStartingCurrency("FR", euroWorldRates)).toEqual({
      currencyCode: "FRF",
      rate: 4.2,
    });
    expect(convertStartingAnchorToLocal(250_000, "FR", euroWorldRates)).toBe(
      Math.round(250_000 * 4.2)
    );
  });

  it("passes a 1991 euro-member world through the legacy map untouched", () => {
    expect(resolveStartingCurrency("FR", euroWorldRates, "1991-default")).toEqual({
      currencyCode: "FRF",
      rate: 4.2,
    });
    expect(convertStartingAnchorToLocal(250_000, "FR", euroWorldRates, "1991-default")).toBe(
      Math.round(250_000 * 4.2)
    );
  });

  it("labels 2027 French wealth options in euros", () => {
    expect(buildWealthOptions("fr", euroWorldRates, "2027-default")).toEqual([
      { value: "low", label: "Low Income - €920,000" },
      { value: "middle", label: "Middle Income - €2,300,000" },
      { value: "high", label: "High Income - €4,600,000" },
    ]);
  });

  it("still falls back to USD parity for unknown codes with a preset", () => {
    expect(convertStartingAnchorToLocal(250_000, "ZZ", euroWorldRates, "2027-default")).toBe(
      250_000
    );
    expect(resolveStartingCurrency("ZZ", euroWorldRates, "2027-default").currencyCode).toBe("USD");
  });
});
