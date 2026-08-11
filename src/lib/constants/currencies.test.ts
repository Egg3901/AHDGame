import { describe, it, expect } from "vitest";
import {
  COUNTRY_CURRENCY_MAP,
  CURRENCY_ANCHOR_COUNTRY,
  FOREX_ACTIVE_COUNTRIES,
  FOREX_ACTIVE_CURRENCIES,
  ZOD_ACTIVE_CURRENCY_ENUM,
  ZOD_CURRENCY_ENUM,
  INITIAL_RATES,
  INITIAL_RATES_1991,
  INITIAL_RATES_1979,
  INITIAL_RATES_1953,
  getCountryIdForCurrency,
  getSeedHardPeg,
  type CurrencyCode,
} from "./currencies";

describe("currency anchor resolution", () => {
  it("anchors EUR to DE and IEP to IE", () => {
    expect(CURRENCY_ANCHOR_COUNTRY.EUR).toBe("DE");
    expect(getCountryIdForCurrency("EUR")).toBe("DE");
    expect(CURRENCY_ANCHOR_COUNTRY.IEP).toBe("IE");
    expect(getCountryIdForCurrency("IEP")).toBe("IE");
  });

  it("each shared currency anchors to a forex-active country", () => {
    // For every currency used by 2+ countries, the anchor must be one of them AND
    // be forex-active (i.e. it actually carries an exchangeRates doc).
    const countriesByCurrency = new Map<CurrencyCode, string[]>();
    for (const [countryId, code] of Object.entries(COUNTRY_CURRENCY_MAP) as Array<
      [string, CurrencyCode]
    >) {
      countriesByCurrency.set(code, [...(countriesByCurrency.get(code) ?? []), countryId]);
    }
    for (const [code, countries] of countriesByCurrency) {
      if (countries.length < 2) continue;
      // Skip currencies shared only by not-yet-launched countries (e.g. the
      // Soviet ruble across BY/BAL before the USSR lands) — they carry no live
      // FX yet, so there's nothing to anchor. The invariant matters once any
      // sharer is forex-active.
      if (!countries.some((c) => (FOREX_ACTIVE_COUNTRIES as string[]).includes(c))) continue;
      const anchor = CURRENCY_ANCHOR_COUNTRY[code];
      expect(countries).toContain(anchor);
      expect(FOREX_ACTIVE_COUNTRIES).toContain(anchor);
    }
  });

  it("anchors every currency to a country that actually uses it (or USD parity)", () => {
    for (const code of ZOD_CURRENCY_ENUM) {
      const anchor = CURRENCY_ANCHOR_COUNTRY[code];
      expect(anchor).toBeDefined();
      // The anchor's home currency is the currency itself, except the parity
      // fallback for currencies with no launched country (e.g. CAD → US/USD).
      const anchorCurrency = COUNTRY_CURRENCY_MAP[anchor];
      const isParityFallback = anchorCurrency === "USD" && code !== "USD";
      expect(anchorCurrency === code || isParityFallback).toBe(true);
    }
  });

  it("resolves single-country currencies to themselves", () => {
    expect(getCountryIdForCurrency("USD")).toBe("US");
    expect(getCountryIdForCurrency("GBP")).toBe("UK");
    expect(getCountryIdForCurrency("JPY")).toBe("JP");
    expect(getCountryIdForCurrency("CNY")).toBe("CN");
    expect(getCountryIdForCurrency("BRL")).toBe("BR");
    expect(getCountryIdForCurrency("NGN")).toBe("NG");
    expect(getCountryIdForCurrency("IEP")).toBe("IE");
  });
});

describe("forex-active currency invariants", () => {
  // NGN was defined but left out of the active lists, so NG bond proceeds settled
  // in a currency that could not be exchanged. Lock the naira in so it can't regress.
  it("includes NGN/NG in every active list", () => {
    expect(FOREX_ACTIVE_CURRENCIES).toContain("NGN");
    expect(FOREX_ACTIVE_COUNTRIES).toContain("NG");
    expect(ZOD_ACTIVE_CURRENCY_ENUM).toContain("NGN");
  });

  it("includes IEP/IE in every active list", () => {
    expect(FOREX_ACTIVE_CURRENCIES).toContain("IEP");
    expect(FOREX_ACTIVE_COUNTRIES).toContain("IE");
    expect(ZOD_ACTIVE_CURRENCY_ENUM).toContain("IEP");
    expect(COUNTRY_CURRENCY_MAP.IE).toBe("IEP");
  });

  it("keeps the active country and currency lists in lockstep via the home-currency map", () => {
    const activeFromCountries = FOREX_ACTIVE_COUNTRIES.map((c) => COUNTRY_CURRENCY_MAP[c]);
    // Every active country's home currency must be forex-active...
    for (const code of activeFromCountries) {
      expect(FOREX_ACTIVE_CURRENCIES).toContain(code);
    }
    // ...and the zod tuple must mirror the currency list exactly.
    expect([...ZOD_ACTIVE_CURRENCY_ENUM].sort()).toEqual([...FOREX_ACTIVE_CURRENCIES].sort());
  });

  it("has an initial exchange rate for every forex-active country in all eras", () => {
    // seedExchangeRates does `rates[countryId]!`, so a missing entry would crash seeding.
    for (const countryId of FOREX_ACTIVE_COUNTRIES) {
      expect(INITIAL_RATES[countryId]).toBeGreaterThan(0);
      expect(INITIAL_RATES_1991[countryId]).toBeGreaterThan(0);
      expect(INITIAL_RATES_1979[countryId]).toBeGreaterThan(0);
      expect(INITIAL_RATES_1953[countryId]).toBeGreaterThan(0);
    }
  });
});

describe("IE sterling hard peg seed", () => {
  it("hard-pegs IEP at GBP Bretton Woods par for 1953-default", () => {
    expect(getSeedHardPeg("IE", "1953-default")).toBe(INITIAL_RATES_1953.IE);
    expect(INITIAL_RATES_1953.IE).toBe(INITIAL_RATES_1953.UK);
  });

  it("does not hard-peg IE after the 1979 EMS break", () => {
    expect(getSeedHardPeg("IE", "1979-default")).toBeUndefined();
    expect(getSeedHardPeg("IE", "1991-default")).toBeUndefined();
    expect(getSeedHardPeg("IE", "2019-default")).toBeUndefined();
  });
});
