import { describe, expect, it } from "vitest";
import { primaryFinancingRate } from "./sovereignPrimarySettlement";
import { eraRateForCurrency } from "@/lib/constants/currencies";

describe("primaryFinancingRate", () => {
  const accounting = (rates: Record<string, number>) => ({
    rates: new Map(Object.entries(rates)),
    preset: "1953-default",
  });

  it("uses the authored era rate for a Warsaw-Pact issuer with no exchangeRates row", () => {
    const rate = primaryFinancingRate(accounting({ USD: 1 }), "RO", "ROL");
    expect(rate).toBe(eraRateForCurrency("ROL", "1953-default"));
    expect(rate).toBeGreaterThan(0);
  });

  it("prefers a live exchangeRates row", () => {
    expect(primaryFinancingRate(accounting({ ROL: 7.5 }), "RO", "ROL")).toBe(7.5);
  });

  it("does not invent a rate for a forex-active currency that lost its row", () => {
    expect(primaryFinancingRate(accounting({}), "UK", "GBP")).toBeUndefined();
  });

  it("does not invent a rate for a currency that is not the issuer's own", () => {
    expect(primaryFinancingRate(accounting({}), "RO", "HUF")).toBeUndefined();
  });
});
