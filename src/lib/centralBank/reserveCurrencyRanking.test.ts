import { describe, it, expect } from "vitest";
import {
  rankReserveCurrencies,
  getLeadingReserveCurrency,
  type ReserveBankInput,
} from "./reserveCurrencyRanking";

// rate = local per 1 internal unit → internal value = units / rate.
const rates = { USD: 1, GBP: 0.7, JPY: 100, CNY: 7 } as const;

describe("rankReserveCurrencies", () => {
  it("aggregates FX (spread-fee) reserves per currency and ranks by internal value", () => {
    const banks: ReserveBankInput[] = [
      { spreadFeeReserveBalances: { JPY: 700, USD: 100 } },
      { spreadFeeReserveBalances: { USD: 50, GBP: 70 } },
    ];

    const ranked = rankReserveCurrencies(banks, rates);
    const byCode = Object.fromEntries(ranked.map((e) => [e.currencyCode, e]));

    // USD: 100 + 50 = 150 units → 150 internal.
    expect(byCode.USD.units).toBe(150);
    expect(byCode.USD.internalValue).toBeCloseTo(150);
    // GBP: 70 units → 100 internal.
    expect(byCode.GBP.internalValue).toBeCloseTo(100);
    // JPY: 700 units → 7 internal.
    expect(byCode.JPY.internalValue).toBeCloseTo(7);

    expect(ranked.map((e) => e.currencyCode)).toEqual(["USD", "GBP", "JPY"]);
    expect(ranked.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("ignores the home lending reserve entirely (only the FX bucket counts)", () => {
    // A huge home reserveBalance must NOT influence the ranking — only
    // spreadFeeReserveBalances is read. (ReserveBankInput has no reserveBalance.)
    const banks: ReserveBankInput[] = [
      { spreadFeeReserveBalances: { USD: 10 } },
      // Bank with no FX reserves contributes nothing even if it held trillions at home.
      {},
    ];
    const ranked = rankReserveCurrencies(banks, rates);
    expect(ranked.map((e) => e.currencyCode)).toEqual(["USD"]);
    expect(ranked[0].units).toBe(10);
  });

  it("skips currencies without a usable rate and non-finite / non-positive balances", () => {
    const banks: ReserveBankInput[] = [
      { spreadFeeReserveBalances: { USD: 100, NGN: 500, GBP: NaN, JPY: 0 } },
    ];
    // NGN has no rate → excluded; GBP is NaN → excluded; JPY is 0 → excluded.
    const ranked = rankReserveCurrencies(banks, rates);
    expect(ranked.map((e) => e.currencyCode)).toEqual(["USD"]);
  });

  it("getLeadingReserveCurrency returns the #1 currency, or null when empty", () => {
    expect(
      getLeadingReserveCurrency([{ spreadFeeReserveBalances: { USD: 200, JPY: 5000 } }], rates)
    ).toBe("USD"); // 200 USD (200 internal) > 5000 JPY (50 internal)
    expect(getLeadingReserveCurrency([], rates)).toBeNull();
    expect(getLeadingReserveCurrency([{ spreadFeeReserveBalances: {} }], rates)).toBeNull();
  });
});
