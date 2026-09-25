import { describe, expect, it } from "vitest";
import {
  COUNTRY_CURRENCY_MAP,
  CURRENCY_ANCHOR_COUNTRY,
  CURRENCY_SYMBOLS,
  FOREX_ACTIVE_COUNTRIES,
  FOREX_ACTIVE_CURRENCIES,
  ZOD_ACTIVE_CURRENCY_ENUM,
  ZOD_CURRENCY_ENUM,
  INITIAL_RATES,
  INITIAL_RATES_1953,
  INITIAL_RATES_1979,
  INITIAL_RATES_1991,
  eraRateForCurrency,
  getCountryIdForCurrency,
  getEraAwareCurrencySymbol,
  getInitialRates,
  getSeedCurrencyCode,
} from "./currencies";
import { RU_2027_RUB_PER_USD } from "@/lib/currency/rules/rubleTransition";

/**
 * Preset-aware Russian ruble (#2289). RU 2027 country data landed, but RU
 * still seeded Soviet SUR money. A 2027-default world now seeds RUB while
 * Cold War/1991 worlds keep SUR byte-identically.
 */
describe("RUB 2027 era isolation", () => {
  it("keeps the era-blind map on SUR (the Soviet identity)", () => {
    expect(COUNTRY_CURRENCY_MAP.RU).toBe("SUR");
  });

  it("seeds RUB only for RU in 2027-default, via the effective preset", () => {
    expect(getSeedCurrencyCode("RU", "2027-default")).toBe("RUB");
    for (const preset of ["1953-default", "1979-default", "1991-default", "2019-default", ""]) {
      expect(getSeedCurrencyCode("RU", preset)).toBe("SUR");
    }
  });

  it("leaves every other country's 2027 seed routing untouched", () => {
    expect(getSeedCurrencyCode("US", "2027-default")).toBe("USD");
    expect(getSeedCurrencyCode("DE", "2027-default")).toBe("EUR");
    expect(getSeedCurrencyCode("FR", "2027-default")).toBe("EUR");
    expect(getSeedCurrencyCode("JP", "2027-default")).toBe("JPY");
  });

  it("preserves the SUR tables in every authored era", () => {
    expect(getInitialRates("1953-default").RU).toBe(9.0);
    expect(getInitialRates("1979-default").RU).toBe(2.22);
    expect(getInitialRates("1991-default").RU).toBe(2.22);
    expect(INITIAL_RATES.RU).toBe(2.22);
    expect(INITIAL_RATES_1953.RU).toBe(9.0);
    expect(INITIAL_RATES_1979.RU).toBe(2.22);
    expect(INITIAL_RATES_1991.RU).toBe(2.22);
  });
});

describe("RUB 2027 anchor and rate source", () => {
  it("anchors 92.5 RUB per USD to the authored RU usdExchangeRate", () => {
    // 1 / 0.01081 (RU_2027 usdExchangeRate) = 92.506, rounded to one decimal.
    expect(RU_2027_RUB_PER_USD).toBe(92.5);
    expect(getInitialRates("2027-default").RU).toBe(92.5);
    expect(1 / 0.01081).toBeCloseTo(92.5, 0);
  });
});

describe("RUB forex registration", () => {
  it("completes the code/type mappings", () => {
    expect(ZOD_CURRENCY_ENUM).toContain("RUB");
    expect(FOREX_ACTIVE_CURRENCIES).toContain("RUB");
    expect(ZOD_ACTIVE_CURRENCY_ENUM).toContain("RUB");
    expect([...ZOD_ACTIVE_CURRENCY_ENUM].sort()).toEqual([...FOREX_ACTIVE_CURRENCIES].sort());
    expect(CURRENCY_ANCHOR_COUNTRY.RUB).toBe("RU");
    expect(getCountryIdForCurrency("RUB")).toBe("RU");
    expect(FOREX_ACTIVE_COUNTRIES).toContain("RU");
  });

  it("symbols the ruble distinctly from the Soviet ruble", () => {
    expect(CURRENCY_SYMBOLS.RUB).toBe("₽");
    expect(CURRENCY_SYMBOLS.SUR).toBe("руб");
    expect(getEraAwareCurrencySymbol("RUB", "2027-default", false, "RU")).toBe("₽");
  });
});

describe("RUB normalization", () => {
  it("resolves the authored 2027 rate without falling to 1.0", () => {
    expect(eraRateForCurrency("RUB", "2027-default")).toBe(92.5);
  });

  it("keeps SUR resolvable in the Soviet eras", () => {
    expect(eraRateForCurrency("SUR", "1991-default")).toBe(2.22);
    expect(eraRateForCurrency("SUR", "1979-default")).toBe(2.22);
    expect(eraRateForCurrency("SUR", "1953-default")).toBe(9.0);
  });
});
