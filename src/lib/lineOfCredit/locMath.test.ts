import { describe, it, expect } from "vitest";
import {
  toInternalUnits,
  fromInternalUnits,
  sumObligationInternal,
  maxLocForExchangeInternal,
  availableForExchangeInternal,
  computeLocInterestForTurn,
  allocateInternalPaymentToLoc,
  LOC_DEPOSIT_FRACTION,
  computePerPlayerDtiLimitInternal,
  computePerPlayerNetWorthLimitInternal,
} from "./locMath";

describe("locMath", () => {
  const rates = { USD: 1, GBP: 0.75, JPY: 106 } as const;

  it("converts internal units consistently", () => {
    expect(toInternalUnits(100, 1)).toBe(100);
    expect(fromInternalUnits(100, 1)).toBe(100);
    expect(toInternalUnits(106, 106)).toBe(1);
  });

  it("sums obligation in internal units", () => {
    const s = sumObligationInternal({ USD: 1000 }, { USD: 200 }, rates as Record<string, number>);
    expect(s).toBe(1200);
  });

  it("maxLocForExchangeInternal is 70% of deposits + reserves", () => {
    expect(maxLocForExchangeInternal(1_000_000, 0)).toBe(1_000_000 * LOC_DEPOSIT_FRACTION);
    expect(maxLocForExchangeInternal(1_000_000, 200_000)).toBe(1_200_000 * LOC_DEPOSIT_FRACTION);
    expect(maxLocForExchangeInternal(0, 0)).toBe(0);
    // Negative pool clamped to zero
    expect(maxLocForExchangeInternal(-500, 0)).toBe(0);
  });

  it("availableForExchangeInternal subtracts total outstanding from cap", () => {
    const avail = availableForExchangeInternal(1_000_000, 0, 200_000);
    expect(avail).toBeCloseTo(1_000_000 * LOC_DEPOSIT_FRACTION - 200_000);
  });

  it("availableForExchangeInternal floors at zero when fully drawn", () => {
    const avail = availableForExchangeInternal(1_000_000, 0, 2_000_000);
    expect(avail).toBe(0);
  });

  it("computeLocInterestForTurn returns 0 for zero obligation", () => {
    expect(computeLocInterestForTurn(0, 0, 5, 2, "USD")).toBe(0);
  });

  it("computePerPlayerDtiLimitInternal converts gross per-turn income into a DTI ceiling", () => {
    const grossIncomePerTurn = 100;
    const limit = computePerPlayerDtiLimitInternal(grossIncomePerTurn, 1);

    expect(limit).toBeCloseTo((0.7 * grossIncomePerTurn) / 0.0040625);
  });

  it("computePerPlayerNetWorthLimitInternal uses equity as a hard LOC ceiling", () => {
    expect(computePerPlayerNetWorthLimitInternal(2_500_000)).toBe(2_500_000);
    expect(computePerPlayerNetWorthLimitInternal(0)).toBe(0);
    expect(computePerPlayerNetWorthLimitInternal(-100)).toBe(0);
  });

  it("allocateInternalPaymentToLoc pays arrears before principal", () => {
    const r = allocateInternalPaymentToLoc(
      50,
      { USD: 1000 },
      { USD: 100 },
      rates as Record<string, number>
    );
    expect(r.appliedInternal).toBe(50);
    expect(r.arrears.USD ?? 0).toBeLessThan(100);
    expect(r.principal.USD).toBe(1000);
  });
});
