import { describe, expect, it } from "vitest";
import { NPP_ECONOMY_DEFAULTS } from "./economyDefaults";
import { getDonorBaseBonusLogarithmic } from "@/lib/utils/fundGeneration";

describe("NPP_ECONOMY_DEFAULTS", () => {
  it("stamps a starting donor base of 1 so NPPs earn donor income from spawn", () => {
    expect(NPP_ECONOMY_DEFAULTS.donorBaseLevel).toBe(1);
  });

  it("starts NPPs with no banked funds, no action points, and never processed", () => {
    expect(NPP_ECONOMY_DEFAULTS.funds).toBe(0);
    expect(NPP_ECONOMY_DEFAULTS.actionPoints).toBe(0);
    expect(NPP_ECONOMY_DEFAULTS.lastActionProcessedTurn).toBe(0);
  });

  it("yields a positive donor bonus at the default level (unlike level 0)", () => {
    const population = 3_000_000;
    const defaultBonus = getDonorBaseBonusLogarithmic(
      NPP_ECONOMY_DEFAULTS.donorBaseLevel as number,
      population
    );
    const levelZeroBonus = getDonorBaseBonusLogarithmic(0, population);
    expect(levelZeroBonus).toBe(0);
    expect(defaultBonus).toBeGreaterThan(0);
  });
});
