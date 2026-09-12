import { describe, expect, it } from "vitest";
import {
  advanceCommodityNominalIndex,
  compoundGlobalInflationHistory,
  medianGlobalInflation,
} from "./commodityNominalIndex";

describe("commodity nominal price index", () => {
  it("compounds the median global inflation rate over one game year", () => {
    const rate = medianGlobalInflation([2, 4, 100, 6]);
    expect(rate).toBe(5);
    expect(
      advanceCommodityNominalIndex({
        index: 1.2,
        lastTurn: 10,
        currentTurn: 58,
        annualInflationPct: rate,
      })
    ).toBeCloseTo(1.26, 10);
  });

  it("uses one elapsed turn for legacy worlds and bounds crisis outliers", () => {
    expect(medianGlobalInflation([-20, 100, 100])).toBe(25);
    expect(
      advanceCommodityNominalIndex({
        index: undefined,
        lastTurn: undefined,
        currentTurn: 100,
        annualInflationPct: 25,
      })
    ).toBeCloseTo(Math.pow(1.25, 1 / 48), 10);
  });

  it("compounds each recorded global turn exactly once", () => {
    const history = new Map([
      [2, [4, 6]],
      [1, [2, 4]],
    ]);
    expect(compoundGlobalInflationHistory(history)).toBeCloseTo(
      Math.pow(1.03, 1 / 48) * Math.pow(1.05, 1 / 48),
      10
    );
  });
});
