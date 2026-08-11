import { describe, it, expect } from "vitest";
import {
  resolveCentralBankCurrency,
  getCurrencyMemberCountries,
  appendSearchParams,
} from "./currencyRouting";
import { COUNTRY_ORDER } from "@/lib/constants/countries";

describe("resolveCentralBankCurrency", () => {
  it("resolves lowercase and uppercase slugs to the anchor country", () => {
    expect(resolveCentralBankCurrency("usd")?.anchorCountryId).toBe("US");
    expect(resolveCentralBankCurrency("USD")?.anchorCountryId).toBe("US");
    expect(resolveCentralBankCurrency("gbp")?.anchorCountryId).toBe("UK");
    expect(resolveCentralBankCurrency("sur")?.anchorCountryId).toBe("RU");
  });

  it("returns the intorg api base path for intorg-run banks (ECB)", () => {
    const eur = resolveCentralBankCurrency("eur");
    expect(eur?.anchorCountryId).toBe("DE");
    expect(eur?.apiBasePath).toBe("/api/intorg/eu/central-bank");
  });

  it("leaves apiBasePath unset for national banks", () => {
    expect(resolveCentralBankCurrency("usd")?.apiBasePath).toBeUndefined();
  });

  it("rejects unknown slugs", () => {
    expect(resolveCentralBankCurrency("xyz")).toBeNull();
    expect(resolveCentralBankCurrency("")).toBeNull();
    expect(resolveCentralBankCurrency("us")).toBeNull(); // country id is not a currency
  });
});

describe("getCurrencyMemberCountries", () => {
  it("returns the single home country for a national currency", () => {
    expect(getCurrencyMemberCountries("USD", COUNTRY_ORDER)).toEqual(["US"]);
    expect(getCurrencyMemberCountries("JPY", COUNTRY_ORDER)).toEqual(["JP"]);
  });

  it("includes activated sterling-zone members for GBP", () => {
    expect(getCurrencyMemberCountries("GBP", COUNTRY_ORDER)).toEqual(["UK"]);
    expect(getCurrencyMemberCountries("GBP", [...COUNTRY_ORDER, "SCO", "WAL"])).toEqual([
      "UK",
      "SCO",
      "WAL",
    ]);
  });

  it("includes activated ruble-zone members for SUR", () => {
    expect(getCurrencyMemberCountries("SUR", COUNTRY_ORDER)).toEqual(["RU"]);
    expect(getCurrencyMemberCountries("SUR", [...COUNTRY_ORDER, "BLR", "BAL"])).toEqual([
      "RU",
      "BLR",
      "BAL",
    ]);
  });

  it("returns empty for CAD (no launched country uses it)", () => {
    expect(getCurrencyMemberCountries("CAD", COUNTRY_ORDER)).toEqual([]);
  });
});

describe("appendSearchParams", () => {
  it("returns the base when there are no params", () => {
    expect(appendSearchParams("/centralbank/usd", {})).toBe("/centralbank/usd");
  });

  it("appends string and array params", () => {
    expect(appendSearchParams("/centralbank/usd", { tab: "savings" })).toBe(
      "/centralbank/usd?tab=savings"
    );
    expect(appendSearchParams("/centralbank/usd", { a: ["1", "2"], b: undefined })).toBe(
      "/centralbank/usd?a=1&a=2"
    );
  });
});
