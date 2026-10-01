import { describe, expect, it } from "vitest";
import {
  ECONOMIC_REFORM_RAMP_PER_TURN,
  ECONOMIC_SYSTEM_TARGET_LEVEL,
  canLegislateEconomicSystem,
  economicReformPull,
  economicSystemReformDirection,
} from "./economicSystemReformRules";
import { COMMAND_CEILING, DUAL_TRACK_CEILING } from "@/lib/constants/commandEconomy";
import { reformRegimeEffects } from "./economicSystemReform";

describe("economic system reform rules", () => {
  it("targets sit inside the band they name", () => {
    expect(ECONOMIC_SYSTEM_TARGET_LEVEL.command).toBeLessThan(COMMAND_CEILING);
    expect(ECONOMIC_SYSTEM_TARGET_LEVEL.dual_track).toBeGreaterThanOrEqual(COMMAND_CEILING);
    expect(ECONOMIC_SYSTEM_TARGET_LEVEL.dual_track).toBeLessThan(DUAL_TRACK_CEILING);
    expect(ECONOMIC_SYSTEM_TARGET_LEVEL.market).toBeGreaterThanOrEqual(DUAL_TRACK_CEILING);
  });

  it("only planned-era countries may legislate their economic system", () => {
    expect(canLegislateEconomicSystem("DD")).toBe(true);
    expect(canLegislateEconomicSystem("RU")).toBe(true);
    expect(canLegislateEconomicSystem("US")).toBe(false);
    expect(canLegislateEconomicSystem("UK")).toBe(false);
    expect(canLegislateEconomicSystem(null)).toBe(false);
  });

  it("ramps at the ramp rate and caps at the remaining gap", () => {
    expect(economicReformPull(0, { targetLevel: 100 }).pull).toBe(ECONOMIC_REFORM_RAMP_PER_TURN);
    expect(economicReformPull(100, { targetLevel: 10 }).pull).toBe(-ECONOMIC_REFORM_RAMP_PER_TURN);
    const last = economicReformPull(99.5, { targetLevel: 100 });
    expect(last.pull).toBeCloseTo(0.5, 10);
    expect(last.reached).toBe(true);
    expect(economicReformPull(50, { targetLevel: 100 }).reached).toBe(false);
  });

  it("a reached law exerts only weak gravity", () => {
    const { pull, reached } = economicReformPull(30, { targetLevel: 45, reachedAtTurn: 1 });
    expect(reached).toBe(true);
    expect(pull).toBeGreaterThan(0);
    expect(pull).toBeLessThan(ECONOMIC_REFORM_RAMP_PER_TURN / 10);
  });

  it("legislators read market reform as economic right and the plan as left", () => {
    expect(economicSystemReformDirection("market")).toBe(1);
    expect(economicSystemReformDirection("dual_track")).toBeGreaterThan(0);
    expect(economicSystemReformDirection("command")).toBe(-1);
  });
});

describe("regime effects of an economic reform law", () => {
  it("liberalizing costs party confidence and buys popular legitimacy", () => {
    const fx = reformRegimeEffects(0, 100);
    expect(fx.leaderConfidence).toBeLessThan(0);
    expect(fx.popularLegitimacy).toBeGreaterThan(0);
  });

  it("returning to the plan does the reverse", () => {
    const fx = reformRegimeEffects(100, 10);
    expect(fx.leaderConfidence).toBeGreaterThan(0);
    expect(fx.popularLegitimacy).toBeLessThan(0);
  });

  it("scales with distance, with a floor for passing the law at all", () => {
    expect(Math.abs(reformRegimeEffects(0, 45).leaderConfidence)).toBeLessThan(
      Math.abs(reformRegimeEffects(0, 100).leaderConfidence)
    );
    expect(reformRegimeEffects(40, 45).leaderConfidence).toBeLessThan(0);
  });

  it("a law that does not move the dial has no regime effect", () => {
    expect(reformRegimeEffects(45, 45)).toEqual({ leaderConfidence: 0, popularLegitimacy: 0 });
  });
});
