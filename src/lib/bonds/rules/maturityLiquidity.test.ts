/** Controlled cumulative maturity coverage, without future financing assumptions. */
import { describe, expect, it } from "vitest";
import { assessMaturityLiquidity } from "./maturityLiquidity";

const input = {
  obligations: [{ principalAnchor: 100, maturityTurn: 101 }],
  liquidCapitalAnchor: 20,
  incomePerTurn: 10 / 48,
  annualCouponObligations: 5,
  currentTurn: 100,
  horizonTurns: 24,
  turnsPerYear: 48,
};

describe("maturity liquidity", () => {
  it("reveals an imminent principal shortfall despite ample annual coupon cover", () => {
    const result = assessMaturityLiquidity(input);
    expect(result.principalDueAnchor).toBe(100);
    expect(result.liquidityScore).toBeCloseTo(((20 + 10 / 48) / (100 + 5 / 48)) * 100);
    expect(result.buckets[0].turnsRemaining).toBe(1);
  });

  it("reserves the current coupon and does not add past or same-turn income again", () => {
    for (const maturityTurn of [90, 100]) {
      const result = assessMaturityLiquidity({
        ...input,
        obligations: [{ principalAnchor: 100, maturityTurn }],
      });
      expect(result.buckets[0].forecastCashAnchor).toBe(20);
      expect(result.buckets[0].turnsRemaining).toBe(0);
      expect(result.buckets[0].couponReserveAnchor).toBeCloseTo(5 / 48);
    }
  });

  it("includes the horizon boundary and preserves absence of near maturities", () => {
    expect(
      assessMaturityLiquidity({
        ...input,
        obligations: [{ principalAnchor: 100, maturityTurn: 124 }],
      }).principalDueAnchor
    ).toBe(100);
    expect(
      assessMaturityLiquidity({
        ...input,
        obligations: [{ principalAnchor: 100, maturityTurn: 125 }],
      })
    ).toEqual({ principalDueAnchor: 0, liquidityScore: null, buckets: [] });
  });

  it("does not spend the same cash on successive principal maturities", () => {
    const result = assessMaturityLiquidity({
      ...input,
      liquidCapitalAnchor: 100,
      incomePerTurn: 0,
      annualCouponObligations: 0,
      obligations: [
        { principalAnchor: 60, maturityTurn: 102 },
        { principalAnchor: 60, maturityTurn: 101 },
      ],
    });
    expect(result.buckets.map((row) => row.cumulativePrincipalAnchor)).toEqual([60, 120]);
    expect(result.liquidityScore).toBeCloseTo((100 * 100) / 120);
  });

  it("groups equal dates and excludes already settled or defaulted paper", () => {
    const result = assessMaturityLiquidity({
      ...input,
      obligations: [
        { principalAnchor: 70, maturityTurn: 101 },
        { principalAnchor: 30, maturityTurn: 101 },
        { principalAnchor: 900, maturityTurn: 101, matured: true },
        { principalAnchor: 900, maturityTurn: 101, defaulted: true },
      ],
    });
    expect(result.buckets).toHaveLength(1);
    expect(result.principalDueAnchor).toBe(100);
  });

  it("caps covered obligations at full liquidity and reflects forecast operating losses", () => {
    expect(assessMaturityLiquidity({ ...input, liquidCapitalAnchor: 200 }).liquidityScore).toBe(
      100
    );
    expect(assessMaturityLiquidity({ ...input, incomePerTurn: -100 }).liquidityScore).toBe(0);
  });

  it("rejects malformed financial or calendar inputs", () => {
    expect(() => assessMaturityLiquidity({ ...input, currentTurn: NaN })).toThrow();
    expect(() => assessMaturityLiquidity({ ...input, turnsPerYear: 0 })).toThrow();
    expect(() => assessMaturityLiquidity({ ...input, incomePerTurn: Infinity })).toThrow();
    expect(() =>
      assessMaturityLiquidity({
        ...input,
        obligations: [{ principalAnchor: -1, maturityTurn: 101 }],
      })
    ).toThrow();
  });
});
