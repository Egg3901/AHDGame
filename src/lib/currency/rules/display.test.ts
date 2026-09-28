import { describe, expect, it } from "vitest";
import { displayQuote, type CurrencyDisplayContext } from "./display";

const early: CurrencyDisplayContext = { preset: "1991-default", eurozoneEnabled: false };
const rates = { EUR: 0.85, IEP: 0.7, GBP: 0.6, BRL: 5, USD: 1.1 };

describe("currency denomination and display", () => {
  it.each(["1979-default", "1991-default"])(
    "converts normalized German units to marks in %s",
    (preset) => {
      const quote = displayQuote({
        preference: "home",
        homeCurrency: "EUR",
        rates,
        context: { ...early, preset },
      });
      expect(quote.symbol).toBe("DM");
      expect(quote.rate * 100).toBeCloseTo(166.24555);
      expect((100 * quote.rate) / quote.rate).toBeCloseTo(100);
    }
  );

  it("uses EUR amounts for an adopted Irish local display, without changing IEP rates", () => {
    const quote = displayQuote({
      preference: "home",
      homeCurrency: "IEP",
      rates,
      context: { ...early, eurozoneEnabled: true },
    });
    expect(quote).toEqual({ rate: 0.85, symbol: "€" });
    expect(rates.IEP).toBe(0.7);
    // 70 stored Irish pounds buy 85 euros at the supplied rates, not 70 euros.
    expect((70 / rates.IEP) * quote.rate).toBeCloseTo(85);
  });

  it("keeps explicitly requested IEP as pounds after adoption", () => {
    expect(
      displayQuote({
        preference: "IEP",
        homeCurrency: "EUR",
        rates,
        context: { ...early, eurozoneEnabled: true },
      })
    ).toEqual({ rate: 0.7, symbol: "IR£" });
  });

  it("does not assume the calendar ratified adoption in a historical world", () => {
    expect(
      displayQuote({ preference: "home", homeCurrency: "IEP", rates, context: early })
    ).toEqual({ rate: 0.7, symbol: "IR£" });
  });

  it("renders the native local currency, independently of the viewer's home", () => {
    expect(
      displayQuote({
        preference: "local",
        homeCurrency: "GBP",
        nativeCurrency: "EUR",
        rates,
        context: early,
      })
    ).toEqual({ rate: 0.85 * 1.95583, symbol: "DM" });
  });

  it("labels a pinned normalized EUR unit without pretending it is a mark", () => {
    expect(displayQuote({ preference: "EUR", homeCurrency: "GBP", rates, context: early })).toEqual(
      { rate: 0.85, symbol: "€ eq." }
    );
  });

  it("does not label normalized Brazilian units as cruzeiros", () => {
    expect(
      displayQuote({ preference: "home", homeCurrency: "BRL", rates, context: early })
    ).toEqual({ rate: 5, symbol: "BRL eq." });
  });

  it.each([undefined, 0, -1, NaN, Infinity])(
    "falls back to shared accounting for invalid EUR quotation %s",
    (rate) => {
      expect(
        displayQuote({
          preference: "home",
          homeCurrency: "IEP",
          rates: { IEP: 0.7, EUR: rate },
          context: { ...early, eurozoneEnabled: true },
        })
      ).toEqual({ rate: 1, symbol: "₳" });
    }
  );

  it("uses the same base-rate fallback for display and input", () => {
    const quote = displayQuote({
      preference: "EUR",
      homeCurrency: "GBP",
      rates: {},
      baseRates: { EUR: 0.9 },
      context: early,
    });
    expect(quote).toEqual({ rate: 0.9, symbol: "€ eq." });
    expect(90 / quote.rate).toBe(100);
  });

  it.each(["internal", "home"] as const)(
    "preserves anchor units while rates are unavailable (%s)",
    (preference) => {
      expect(
        displayQuote({ preference, homeCurrency: "EUR", rates: null, context: early })
      ).toEqual({ rate: 1, symbol: "₳" });
    }
  );
});

describe("1953 ledger calibration", () => {
  it("preserves actual marks before adoption and converts their display after adoption", () => {
    const params = {
      preference: "home" as const,
      homeCurrency: "EUR" as const,
      rates: { EUR: 4.2 },
      context: { preset: "1953-default", eurozoneEnabled: false },
    };
    expect(displayQuote(params)).toEqual({ rate: 4.2, symbol: "DM" });
    const adopted = displayQuote({
      ...params,
      context: { ...params.context, eurozoneEnabled: true },
    });
    expect(adopted.symbol).toBe("€");
    expect(adopted.rate).toBeCloseTo(4.2 / 1.95583);
  });
});
