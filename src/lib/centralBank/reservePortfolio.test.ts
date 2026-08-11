import { describe, expect, it } from "vitest";
import {
  buildReservePortfolioSummary,
  convertCurrencyAmount,
} from "@/lib/centralBank/reservePortfolio";

describe("convertCurrencyAmount", () => {
  it("converts through internal units using local-per-internal rates", () => {
    expect(
      convertCurrencyAmount({
        amount: 750,
        fromCurrency: "GBP",
        toCurrency: "USD",
        rates: { GBP: 0.75, USD: 1 },
      })
    ).toBe(1000);
  });

  it("returns zero when a foreign rate is missing", () => {
    expect(
      convertCurrencyAmount({
        amount: 100,
        fromCurrency: "EUR",
        toCurrency: "CNY",
        rates: { EUR: 0.9 },
      })
    ).toBe(0);
  });
});

describe("buildReservePortfolioSummary", () => {
  it("values collected-currency spread reserves in the central bank home currency", () => {
    const summary = buildReservePortfolioSummary({
      homeCurrency: "CNY",
      reserveBalance: 1_000,
      spreadFeeReserveBalances: { USD: 100, GBP: 75, CNY: 200 },
      rates: { USD: 1, GBP: 0.75, CNY: 7.2 },
    });

    expect(summary.homeReserveBalance).toBe(1_000);
    expect(summary.spreadFeeReservesHomeValue).toBe(1_640);
    expect(summary.totalReservesHomeValue).toBe(2_640);
    expect(summary.foreignEntries.map((entry) => entry.currencyCode)).toEqual(["USD", "GBP"]);
    expect(summary.entries.find((entry) => entry.currencyCode === "CNY")?.valueInHomeCurrency).toBe(
      200
    );
  });
});
