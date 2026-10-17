import { describe, expect, it } from "vitest";
import { corporateCashArrearsAnchor } from "./cashArrears";

describe("corporate invoice liabilities", () => {
  it("includes unpaid producer bills alongside tax and other cash debts", () => {
    expect(
      corporateCashArrearsAnchor({
        operatingByCurrency: { JPY: 226 },
        federalTaxByCountryAnchor: { US: 50 },
        producerPayables: [{ amount: 10 }, { amount: 20 }],
        fxByCurrency: new Map([["JPY", 113]]),
      })
    ).toBe(82);
  });
  it("never treats a negative or non-finite invoice as extra equity", () => {
    for (const amount of [-1, Infinity, NaN])
      expect(() =>
        corporateCashArrearsAnchor({ producerPayables: [{ amount }], fxByCurrency: new Map() })
      ).toThrow("invoice liability");
  });
});
