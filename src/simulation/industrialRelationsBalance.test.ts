import { describe, expect, it } from "vitest";
import { runIndustrialRelationsBalanceScenarios } from "./industrialRelationsBalance";

describe("industrial-relations balance scenarios", () => {
  it("orders bargaining power from fragmented to strong conditions", () => {
    const [weak, viable, strong] = runIndustrialRelationsBalanceScenarios();

    expect(weak.support).toBeLessThan(viable.support);
    expect(viable.support).toBeLessThan(strong.support);
    expect(weak.leverage).toBeLessThan(viable.leverage);
    expect(viable.leverage).toBeLessThan(strong.leverage);
    expect(weak.canOvertimeBan).toBe(false);
    expect(viable.canOvertimeBan).toBe(true);
    expect(strong.canIndustryStrike).toBe(true);
  });

  it("keeps the escalation ladder economically progressive and bounded", () => {
    for (const result of runIndustrialRelationsBalanceScenarios()) {
      expect(result.overtimeBanOutputLossPercent).toBe(4);
      expect(result.selectiveStrikeScopeOutputLossPercent).toBeGreaterThan(
        result.overtimeBanOutputLossPercent
      );
      expect(result.selectiveStrikeScopeOutputLossPercent).toBeLessThanOrEqual(25);
      expect(result.industryStrikeOutputLossPercent).toBe(25);
      expect(result.selectiveStrikeCost).toBeLessThanOrEqual(result.industryStrikeCost);
      expect(result.strikeFundRunway).toBeLessThanOrEqual(6);
    }
  });

  it("gives the same union a stronger mandate where living costs are higher", () => {
    const [, viable, , expensive] = runIndustrialRelationsBalanceScenarios();

    expect(expensive.support).toBeGreaterThan(viable.support);
    expect(expensive.leverage).toBeGreaterThan(viable.leverage);
  });

  it("unlocks one ladder rung per achievable shop floor", () => {
    const [, , , , rung1, rung2, rung3] = runIndustrialRelationsBalanceScenarios();

    // Neutral union law throughout: the ladder must be climbable on organizing
    // and a real wage gap alone, without a friendly government.
    expect(rung1.canOvertimeBan).toBe(true);
    expect(rung1.canSelectiveStrike).toBe(false);

    expect(rung2.canSelectiveStrike).toBe(true);
    expect(rung2.canIndustryStrike).toBe(false);

    expect(rung3.canIndustryStrike).toBe(true);
  });
});
