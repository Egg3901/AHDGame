import { describe, expect, it } from "vitest";
import { projectBondMaturityAffordability } from "./bondMaturityAffordability";

describe("projectBondMaturityAffordability", () => {
  it("counts positive retained earnings through the maturity turn", () => {
    expect(
      projectBondMaturityAffordability({
        currentLiquidCapital: 154_000,
        repaymentAmount: 775_000,
        turnsRemaining: 95,
        retainedEarningsPerTurn: 31_250,
      })
    ).toEqual({
      cashAtMaturity: 3_122_750,
      shortfall: 0,
      isCovered: true,
      usedProjection: true,
    });
  });

  it("reports the projected shortfall when retained earnings are not enough", () => {
    expect(
      projectBondMaturityAffordability({
        currentLiquidCapital: 100,
        repaymentAmount: 1_000,
        turnsRemaining: 5,
        retainedEarningsPerTurn: 100,
      })
    ).toEqual({
      cashAtMaturity: 600,
      shortfall: 400,
      isCovered: false,
      usedProjection: true,
    });
  });

  it("keeps today's affordability when retained earnings are negative", () => {
    expect(
      projectBondMaturityAffordability({
        currentLiquidCapital: 100,
        repaymentAmount: 200,
        turnsRemaining: 5,
        retainedEarningsPerTurn: -100,
      })
    ).toEqual({
      cashAtMaturity: 100,
      shortfall: 100,
      isCovered: false,
      usedProjection: false,
    });
  });

  it("keeps today's affordability when retained earnings are unknown", () => {
    expect(
      projectBondMaturityAffordability({
        currentLiquidCapital: 100,
        repaymentAmount: 200,
        turnsRemaining: 5,
        retainedEarningsPerTurn: null,
      })
    ).toEqual({
      cashAtMaturity: 100,
      shortfall: 100,
      isCovered: false,
      usedProjection: false,
    });
  });
});
