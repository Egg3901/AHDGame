import { describe, expect, it } from "vitest";
import { FOREX_ACTIVE_CURRENCIES, type CurrencyCode } from "@/lib/constants/currencies";
import { checkBalancedTransfer, type ValueLeg } from "@/lib/banking/rules/invariants";
import { quoteLocService, type LocServiceInput } from "./servicing";

describe("fractional LOC funding", () => {
  const cases: {
    name: string;
    currency: CurrencyCode;
    personal: LocServiceInput["personal"];
    savings: LocServiceInput["savings"];
    expected: number;
  }[] = [
    { name: "personal USD", currency: "USD", personal: { USD: 10.004 }, savings: {}, expected: 10 },
    {
      name: "mixed USD",
      currency: "USD",
      personal: { USD: 5 },
      savings: { USD: 2.0049 },
      expected: 7,
    },
    {
      name: "savings USD",
      currency: "USD",
      personal: {},
      savings: { USD: 3.3333333 },
      expected: 3.33,
    },
    {
      name: "cross-currency GBP",
      currency: "USD",
      personal: { GBP: 10.004 },
      savings: {},
      expected: 0,
    },
    { name: "fractional JPY", currency: "JPY", personal: { JPY: 10.9 }, savings: {}, expected: 10 },
  ];
  it.each(cases)(
    "balances settlement flows for $name",
    ({ currency, personal, savings, expected }) => {
      const quote = quoteLocService({
        loc: { balances: { [currency]: 100000 }, arrears: {} },
        personal,
        savings,
        rates: { USD: 1, GBP: 0.8, JPY: 100 },
        prime: {},
        spread: 0,
        centralBankSpread: 0,
        incomeInternal: 0,
      });
      const flows: (ValueLeg & { currency: string })[] = [];
      for (const c of FOREX_ACTIVE_CURRENCIES) {
        for (const [kind, amount] of [
          ["debit", quote.consumed[c] ?? 0],
          ["credit", quote.interestPortions[c] ?? 0],
          ["burn", quote.principalPortions[c] ?? 0],
        ] as const) {
          if (amount > 0) flows.push({ currency: c, kind, amount });
        }
        expect(quote.walletPayments[c] ?? 0).toBeLessThanOrEqual(
          (personal[c] ?? 0) + (savings[c] ?? 0)
        );
      }
      for (const [target, sources] of Object.entries(quote.crossConverted)) {
        for (const [source, amount] of Object.entries(sources ?? {})) {
          if (amount && amount > 0) flows.push({ currency: source, kind: "burn", amount });
          expect(amount).toBe(10);
          expect(amount ?? 0).toBeLessThanOrEqual(
            (personal[source as CurrencyCode] ?? 0) + (savings[source as CurrencyCode] ?? 0)
          );
        }
        const received =
          (quote.payments[target as CurrencyCode] ?? 0) -
          (quote.walletPayments[target as CurrencyCode] ?? 0);
        if (received > 0) flows.push({ currency: target, kind: "mint", amount: received });
      }
      for (const c of FOREX_ACTIVE_CURRENCIES) {
        expect(
          checkBalancedTransfer(
            flows.filter((flow) => flow.currency === c),
            c
          )
        ).toEqual([]);
      }
      expect(quote.walletPayments[currency] ?? 0).toBe(expected);
    }
  );
  it("spends a whole-cent wallet in full without a binary-noise shortfall", () => {
    for (const amount of [1.13, 4.35, 8.2, 0.29]) {
      const quote = quoteLocService({
        loc: {
          balances: {},
          arrears: { USD: amount },
          paymentMode: { USD: "io" },
        } as LocServiceInput["loc"],
        personal: { USD: amount },
        savings: {},
        rates: { USD: 1 },
        prime: {},
        spread: 0,
        centralBankSpread: 0,
        incomeInternal: 0,
      });
      expect(quote.walletPayments.USD).toBe(amount);
    }
  });
});
