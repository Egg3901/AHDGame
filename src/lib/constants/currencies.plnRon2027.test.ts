import { describe, expect, it } from "vitest";
import { getCountryConfig } from "./countries";
import {
  COUNTRY_CURRENCY_MAP,
  CURRENCY_ANCHOR_COUNTRY,
  CURRENCY_SYMBOLS,
  FOREX_ACTIVE_COUNTRIES,
  ZOD_CURRENCY_ENUM,
  eraRateForCurrency,
  getInitialRates,
  getSeedCurrencyCode,
} from "./currencies";

/**
 * NBP: 10,000 old złoty became 1 new złoty on 1 January 1995.
 * https://nbp.pl/wp-content/uploads/2022/11/Bankoteka_3_December_2013_internet.pdf
 * NBR: 10,000 old lei became 1 RON on 1 July 2005.
 * https://bnr.ro/files/d/Pubs_ro/Lunare/2008bl/2008bl03.pdf
 */
describe("PLN and RON in the 2027 world", () => {
  it("routes modern codes in 2019 and 2027 while retaining 1991 identities", () => {
    expect(getSeedCurrencyCode("PL", "2027-default")).toBe("PLN");
    expect(getSeedCurrencyCode("RO", "2027-default")).toBe("RON");
    expect(getCountryConfig("PL", "2027-default").currencyCode).toBe("PLN");
    expect(getCountryConfig("RO", "2027-default").currencyCode).toBe("RON");
    for (const preset of ["2019-default", "2027-default"]) {
      expect(getSeedCurrencyCode("PL", preset)).toBe("PLN");
      expect(getSeedCurrencyCode("RO", preset)).toBe("RON");
    }
    for (const preset of ["1953-default", "1979-default", "1991-default"]) {
      expect(getSeedCurrencyCode("PL", preset)).toBe("PLZ");
      expect(getSeedCurrencyCode("RO", preset)).toBe("ROL");
    }
    expect(COUNTRY_CURRENCY_MAP.PL).toBe("PLZ");
    expect(COUNTRY_CURRENCY_MAP.RO).toBe("ROL");
  });

  it("uses issuing-bank 2024 USD averages for the 2024 regional GDP units", () => {
    const rates = getInitialRates("2027-default");
    expect(rates.PL).toBe(3.9812);
    expect(rates.RO).toBe(4.5984);
    expect(eraRateForCurrency("PLN", "2027-default")).toBe(rates.PL);
    expect(eraRateForCurrency("RON", "2027-default")).toBe(rates.RO);
    expect(getCountryConfig("PL", "2027-default").usdExchangeRate).toBeCloseTo(1 / rates.PL!, 12);
    expect(getCountryConfig("RO", "2027-default").usdExchangeRate).toBeCloseTo(1 / rates.RO!, 12);
    expect(getInitialRates("1991-default").PL).toBe(9_500);
    expect(getInitialRates("1991-default").RO).toBe(34.7);
    expect(eraRateForCurrency("PLN", "1991-default")).toBeUndefined();
    expect(eraRateForCurrency("RON", "1991-default")).toBeUndefined();
    expect(eraRateForCurrency("PLZ", "1991-default")).toBe(9_500);
    expect(eraRateForCurrency("ROL", "1991-default")).toBe(34.7);
  });

  it("registers codes and anchors without claiming unauthored forex support", () => {
    expect(ZOD_CURRENCY_ENUM).toEqual(expect.arrayContaining(["PLN", "RON"]));
    expect(CURRENCY_ANCHOR_COUNTRY.PLN).toBe("PL");
    expect(CURRENCY_ANCHOR_COUNTRY.RON).toBe("RO");
    expect(CURRENCY_SYMBOLS.PLN).toBe("zł");
    expect(CURRENCY_SYMBOLS.RON).toBe("lei");
    expect(FOREX_ACTIVE_COUNTRIES).not.toContain("PL");
    expect(FOREX_ACTIVE_COUNTRIES).not.toContain("RO");
  });
});
