import { describe, expect, it } from "vitest";
import {
  COUNTRY_CURRENCY_MAP,
  FOREX_ACTIVE_COUNTRIES,
  eraRateForCurrency,
} from "@/lib/constants/currencies";

/**
 * The Warsaw-Pact six are deliberately outside `FOREX_ACTIVE_COUNTRIES` —
 * `seedExchangeRates` never writes them a row, because they are budget-only
 * economies (refs #3778 §1). But `COUNTRY_CURRENCY_MAP` still gives their
 * corporations a real `liquidCurrencyCode`, so every FX helper that branches on
 * "has a code" took the convert path, found no rate document, and silently
 * returned 1.0 — reading 1 złoty as ₳1.
 *
 * `commodityPriceTurn.ts` already solved this for budgets and states the rule:
 * "The authored era rate is the correct answer, so resolve it from the preset's
 * table before conceding to 1.0." This helper is that rule, extracted.
 */
describe("eraRateForCurrency", () => {
  it("resolves the authored 1953 rate for a currency with no exchangeRates row", () => {
    // Poland: official parity was 4 zł/USD; the seed deliberately uses the
    // non-commercial rate of 24 because the official one prices Poland as a
    // $75B economy — larger than West Germany plus the UK combined.
    expect(eraRateForCurrency("PLZ", "1953-default")).toBe(24.0);
  });

  it("covers every Warsaw-Pact currency, which is the whole point", () => {
    for (const code of ["PLZ", "CSK", "ROL", "YUD", "BGL", "HUF"] as const) {
      const rate = eraRateForCurrency(code, "1953-default");
      expect(rate, `${code} has no authored 1953 rate`).toBeGreaterThan(0);
      expect(rate, `${code} resolved to the 1.0 fallback this exists to prevent`).not.toBe(1.0);
    }
  });

  it("has an authored rate for every currency assigned to a country", () => {
    // The invariant that actually matters: if a country has a currency code, a
    // corp of that country can be valued, so a rate must exist. This is the
    // check that would have caught the gap.
    for (const [countryId, code] of Object.entries(COUNTRY_CURRENCY_MAP)) {
      // SCO/WAL share GBP and have no separate economy.
      if (countryId === "SCO" || countryId === "WAL") continue;
      expect(
        eraRateForCurrency(code, "1953-default"),
        `${countryId} (${code}) has no 1953 rate — a corp of this country would be valued at 1.0`
      ).toBeGreaterThan(0);
    }
  });

  it("still resolves the forex-active currencies, which have rows too", () => {
    expect(eraRateForCurrency("JPY", "1953-default")).toBe(360.0);
    expect(eraRateForCurrency("USD", "1953-default")).toBe(1.0);
    expect(FOREX_ACTIVE_COUNTRIES).toContain("JP");
  });

  it("returns undefined for an unknown code rather than guessing", () => {
    expect(eraRateForCurrency(undefined, "1953-default")).toBeUndefined();
    expect(eraRateForCurrency("ZZZ" as never, "1953-default")).toBeUndefined();
  });
});
