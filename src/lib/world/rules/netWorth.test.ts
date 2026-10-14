import { describe, expect, it } from "vitest";
import { liquidBalancesAnchor, personalDebtAnchor } from "./netWorth";
describe("career asset valuation", () => {
  const rates = new Map([
    ["USD", 1],
    ["GBP", 2],
  ]);
  it("values every currency pocket and never double counts a legacy mirror", () => {
    expect(
      liquidBalancesAnchor({
        homeCurrency: "USD",
        personal: { USD: 100, GBP: 100 },
        savings: { GBP: 40 },
        legacyPersonal: 999,
        legacySavings: 10,
        rates,
      })
    ).toEqual({ personal: 150, savings: 30 });
  });
  it("preserves value when cash moves to savings or an equivalent foreign pocket", () => {
    const base = { homeCurrency: "USD", legacyPersonal: 0, legacySavings: 0, rates };
    expect(liquidBalancesAnchor({ ...base, personal: { USD: 100 } }).personal).toBe(100);
    expect(liquidBalancesAnchor({ ...base, savings: { GBP: 200 } }).savings).toBe(100);
  });
  it("converts outstanding personal liabilities without crediting invalid balances", () => {
    expect(
      personalDebtAnchor(
        [
          { borrowerId: "a", currency: "GBP", outstanding: 200 },
          { borrowerId: "a", currency: "USD", outstanding: 20 },
          { borrowerId: "b", currency: "USD", outstanding: -20 },
        ],
        rates
      )
    ).toEqual(
      new Map([
        ["a", 120],
        ["b", 0],
      ])
    );
  });
});
