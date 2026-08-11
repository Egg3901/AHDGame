import { describe, it, expect } from "vitest";
import { getInitialRates } from "@/lib/constants/currencies";

describe("getInitialRates", () => {
  it("returns 2019 rates for 2019-default", () => {
    const rates = getInitialRates("2019-default");
    expect(rates.UK).toBeCloseTo(0.75);
    expect(rates.JP).toBeCloseTo(106.0);
    expect(rates.DE).toBeCloseTo(0.92);
  });

  it("returns 1991 rates for 1991-default", () => {
    const rates = getInitialRates("1991-default");
    // GBP stronger vs USD in 1991
    expect(rates.UK).toBeCloseTo(0.57);
    // JPY weaker vs USD in 1991
    expect(rates.JP).toBeCloseTo(134.5);
    // DEM-equivalent EUR weaker vs USD in 1991
    expect(rates.DE).toBeCloseTo(0.85);
    // CNY — official 1991 rate
    expect(rates.CN).toBeCloseTo(5.32);
  });

  it("falls back to 2019 rates for unknown preset", () => {
    const rates = getInitialRates("3000-default");
    expect(rates.UK).toBeCloseTo(0.75);
  });

  it("returns 1953 rates for 1953-default including IE at GBP par", () => {
    const rates = getInitialRates("1953-default");
    expect(rates.UK).toBeCloseTo(0.357);
    expect(rates.IE).toBeCloseTo(0.357);
    expect(rates.DE).toBeCloseTo(4.2);
  });
});
