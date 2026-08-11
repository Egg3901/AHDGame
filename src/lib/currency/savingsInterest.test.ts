import { describe, it, expect } from "vitest";
import {
  computeSavingsInterestForTurn,
  estimateSavingsAccrualFromApy,
  interestEligibleBalance,
  roundSavingsAmount,
  SAVINGS_POOL_SHARE_CAP,
  savingsApyPercent,
  SAVINGS_REAL_RATE_FLOOR_PERCENT,
} from "./savingsInterest";

describe("interestEligibleBalance (pool-share cap #3064)", () => {
  it("does not cap an account below the pool share", () => {
    // account is 10% of a 1000 pool, cap is 25% -> full balance eligible
    expect(interestEligibleBalance(100, 1000)).toBe(100);
  });

  it("caps a whale to the pool-share fraction", () => {
    // account is ~100% of the pool -> earns interest on only 25% of it
    expect(interestEligibleBalance(1000, 1000)).toBe(SAVINGS_POOL_SHARE_CAP * 1000);
  });

  it("passes the full balance through when the pool basis is unknown/zero", () => {
    expect(interestEligibleBalance(500, 0)).toBe(500);
  });

  it("quarters the interest of an account that is the whole pool", () => {
    const whole = computeSavingsInterestForTurn(interestEligibleBalance(4800, 4800), 4, "USD");
    const uncapped = computeSavingsInterestForTurn(4800, 4, "USD");
    expect(whole).toBeCloseTo(uncapped * SAVINGS_POOL_SHARE_CAP, 6);
  });
});

describe("computeSavingsInterestForTurn", () => {
  it("accrues half of prime as APY spread over the year (zero inflation)", () => {
    // 4% prime, 0 inflation → 2% APY on 4800 → 96/year → 2 per turn at 48 turns/year
    expect(computeSavingsInterestForTurn(4800, 4, "USD")).toBe(2);
  });

  it("pays the REAL rate: inflation eats nominal prime (carry-trade fix)", () => {
    // A high-nominal-rate currency with matching inflation pays only the floor,
    // NOT half of its headline prime — this is what kills the cross-currency carry.
    // prime 12, inflation 12 → real ≤ 0 → floored APY = 0.25% on 4800 = 0.5/turn.
    const flooredPerTurn = computeSavingsInterestForTurn(4800, 12, "USD", 12);
    expect(flooredPerTurn).toBe(
      computeSavingsInterestForTurn(4800, SAVINGS_REAL_RATE_FLOOR_PERCENT, "USD", 0)
    );
    // and it is far below the old nominal-prime accrual (½·12% = 6% APY → 6/turn)
    expect(flooredPerTurn).toBeLessThan(computeSavingsInterestForTurn(4800, 12, "USD", 0));
  });

  it("real spread: prime 8 / inflation 4 pays half the 4pp real rate", () => {
    // real 4 → 2% APY on 4800 → 2/turn, same as a 4%-prime zero-inflation currency
    expect(computeSavingsInterestForTurn(4800, 8, "USD", 4)).toBe(
      computeSavingsInterestForTurn(4800, 4, "USD", 0)
    );
  });

  it("rounds JPY to whole units", () => {
    expect(computeSavingsInterestForTurn(100000, 0.2, "JPY")).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(computeSavingsInterestForTurn(480000, 4, "JPY"))).toBe(true);
  });
});

describe("savingsApyPercent", () => {
  it("is half the real rate (prime − inflation)", () => {
    expect(savingsApyPercent(8, 4)).toBe(2);
  });
  it("floors uniformly so no currency pays a negative real rate", () => {
    expect(savingsApyPercent(12, 20)).toBe(SAVINGS_REAL_RATE_FLOOR_PERCENT / 2);
    expect(savingsApyPercent(0, 0)).toBe(SAVINGS_REAL_RATE_FLOOR_PERCENT / 2);
  });
});

describe("estimateSavingsAccrualFromApy", () => {
  it("matches per-turn accrual from prime (APY = prime/2)", () => {
    expect(estimateSavingsAccrualFromApy(4800, 2, "USD")).toBe(
      computeSavingsInterestForTurn(4800, 4, "USD")
    );
  });
});

describe("roundSavingsAmount", () => {
  it("rounds non-JPY to 2 decimals", () => {
    expect(roundSavingsAmount(1.234, "USD")).toBe(1.23);
  });

  it("rounds JPY to integer", () => {
    expect(roundSavingsAmount(106.7, "JPY")).toBe(107);
  });
});
