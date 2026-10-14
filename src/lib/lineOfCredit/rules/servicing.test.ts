import { describe, expect, it } from "vitest";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { checkBalancedTransfer, type ValueLeg } from "@/lib/banking/rules/invariants";
import { quoteLocService, type LocServiceInput } from "./servicing";

function input(wallet: number, currency: CurrencyCode = "USD"): LocServiceInput {
  return {
    loc: { balances: { [currency]: currency === "JPY" ? 10000 : 100 }, arrears: {} },
    personal: { [currency]: wallet },
    savings: {},
    rates: { [currency]: 1 },
    prime: { [currency]: 2.5 },
    spread: 2,
    centralBankSpread: 0,
    incomeInternal: 0,
  };
}

// These are the per-currency cash legs emitted by prepareServiceEffect.
function expectBalanced(quote: ReturnType<typeof quoteLocService>, currency: CurrencyCode) {
  const legs: ValueLeg[] = [
    { kind: "debit", amount: quote.consumed[currency] ?? 0 },
    { kind: "credit", amount: quote.interestPortions[currency] ?? 0 },
    { kind: "burn", amount: quote.principalPortions[currency] ?? 0 },
  ];
  for (const [target, sources] of Object.entries(quote.crossConverted)) {
    legs.push({ kind: "burn", amount: sources?.[currency] ?? 0 });
    if (target === currency)
      legs.push({
        kind: "mint",
        amount: (quote.payments[currency] ?? 0) - (quote.walletPayments[currency] ?? 0),
      });
  }
  expect(checkBalancedTransfer(legs, currency)).toEqual([]);
}

describe("quoteLocService fractional wallets", () => {
  it("leaves a sub-cent USD wallet unpaid", () => {
    const quote = quoteLocService(input(0.005));
    expect(quote.walletPayments.USD ?? 0).toBe(0);
    expect(quote.payments.USD ?? 0).toBe(0);
    expectBalanced(quote, "USD");
  });

  it("uses only the whole cent in a fractional USD wallet", () => {
    const quote = quoteLocService(input(0.015));
    expect(quote.walletPayments.USD).toBe(0.01);
    expect(quote.interestPortions.USD! + quote.principalPortions.USD!).toBeCloseTo(0.01, 9);
    expectBalanced(quote, "USD");
  });

  it("balances payments without overdrawing fractional USD wallets", () => {
    const wallets = Array.from({ length: 999 }, (_, i) => (i + 1) / 1000);
    for (const wallet of [...wallets, 12.345, 1.005, 100.999]) {
      const quote = quoteLocService(input(wallet));
      const consumed = quote.consumed.USD ?? 0;
      expect(consumed).toBeLessThanOrEqual(wallet);
      expect(consumed).toBeCloseTo(
        (quote.interestPortions.USD ?? 0) + (quote.principalPortions.USD ?? 0),
        9
      );
      expectBalanced(quote, "USD");
    }
  });

  it("uses only whole yen from a fractional JPY wallet", () => {
    const quote = quoteLocService(input(1.5, "JPY"));
    expect(quote.walletPayments.JPY).toBe(1);
    expect(quote.consumed.JPY).toBeLessThanOrEqual(1.5);
    expectBalanced(quote, "JPY");
  });

  it("balances each currency when another wallet funds the shortfall", () => {
    const serviceInput = input(0.015);
    serviceInput.personal.GBP = 10;
    serviceInput.rates.GBP = 0.75;
    const quote = quoteLocService(serviceInput);
    expect(quote.walletPayments.USD).toBe(0.01);
    expect(quote.crossConverted.USD?.GBP).toBeGreaterThan(0);
    expect(quote.consumed.GBP).toBe(quote.crossConverted.USD?.GBP);
    expectBalanced(quote, "USD");
    expectBalanced(quote, "GBP");
  });
});
