import { describe, expect, it } from "vitest";
import { resolvePrimeForCurrency } from "./lineOfCreditTurn";

describe("line of credit central-bank routing", () => {
  it("uses the shared ECB prime rate for euro-area credit scoring and accrual", () => {
    const rates = new Map([
      ["ECB", 7.25],
      ["US", 4.5],
    ]);

    expect(resolvePrimeForCurrency(rates, "EUR")).toBe(7.25);
    expect(resolvePrimeForCurrency(rates, "USD")).toBe(4.5);
  });
});
