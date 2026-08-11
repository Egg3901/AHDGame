import { describe, it, expect } from "vitest";
import {
  spreadPercentPointsFromComposite,
  incomeScoreFromPerTurnCurrency,
  netWorthScoreFromInternal,
  userCreditComposite,
  applyDebtLeveragePenalty,
  applyPrimeEnvironmentToComposite,
  computeLocBorrowerComposite,
} from "./creditMath";

describe("creditMath", () => {
  it("maps composite to spread +5 at 0 and -1 at 100", () => {
    expect(spreadPercentPointsFromComposite(0)).toBe(5);
    expect(spreadPercentPointsFromComposite(100)).toBe(-1);
    expect(spreadPercentPointsFromComposite(50)).toBeCloseTo(2, 5);
  });

  it("clamps composite input for spread", () => {
    expect(spreadPercentPointsFromComposite(-10)).toBe(5);
    expect(spreadPercentPointsFromComposite(200)).toBe(-1);
  });

  it("userCreditComposite uses 75/25 when corp present", () => {
    const v = userCreditComposite({
      corpComposite: 80,
      incomeScore: 40,
      netWorthScore: 10,
    });
    expect(v).toBe(0.75 * 80 + 0.25 * 40);
  });

  it("userCreditComposite uses 50/50 without corp", () => {
    const v = userCreditComposite({
      corpComposite: null,
      incomeScore: 40,
      netWorthScore: 60,
    });
    expect(v).toBe(50);
  });

  it("incomeScore is 0 for non-positive per-turn income", () => {
    expect(incomeScoreFromPerTurnCurrency(0)).toBe(0);
    expect(incomeScoreFromPerTurnCurrency(-1)).toBe(0);
  });

  it("netWorthScore is 0 for non-positive NW", () => {
    expect(netWorthScoreFromInternal(0)).toBe(0);
    expect(netWorthScoreFromInternal(-1)).toBe(0);
  });

  it("applyDebtLeveragePenalty reduces composite when leveraged", () => {
    expect(applyDebtLeveragePenalty(80, 0)).toBe(80);
    expect(applyDebtLeveragePenalty(80, 0.5)).toBeLessThan(80);
  });

  it("applyPrimeEnvironmentToComposite eases stress for wealthier borrowers", () => {
    const high = applyPrimeEnvironmentToComposite(70, 6, 80);
    const low = applyPrimeEnvironmentToComposite(70, 6, 20);
    expect(high).toBeGreaterThan(low);
  });

  it("computeLocBorrowerComposite stays within 0–100", () => {
    const v = computeLocBorrowerComposite({
      corpComposite: null,
      incomeScore: 50,
      netWorthScore: 50,
      debtToAssetsRatio: 0.4,
      homePrimePercent: 5,
    });
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(100);
  });
});
