import { describe, it, expect } from "vitest";
import { energyActionLimits, applyTurnDrift } from "../statDrift";
import {
  USE_GROWTH_INCREMENT,
  ENERGY_MAINTENANCE_XP,
  type CharacterStats,
} from "../statsConstants";

const stats: CharacterStats = {
  charisma: 5,
  debate: 5,
  energy: 5,
  fundraising: 5,
  businessAcumen: 5,
  statecraft: 5,
  intellect: 5,
};

describe("energyActionLimits", () => {
  it("returns baseline 200/100 at Energy 1", () => {
    expect(energyActionLimits(1)).toEqual({ cap: 200, threshold: 100 });
  });

  it("returns max 250/125 at Energy 10", () => {
    expect(energyActionLimits(10)).toEqual({ cap: 250, threshold: 125 });
  });

  it("scales linearly in between", () => {
    const mid = energyActionLimits(5.5); // halfway
    expect(mid.cap).toBe(225);
    expect(mid.threshold).toBeGreaterThan(100);
    expect(mid.threshold).toBeLessThan(125);
  });
});

describe("applyTurnDrift", () => {
  it("does not apply idle decay — stats are permanent", () => {
    const { stats: next } = applyTurnDrift(stats, undefined);
    expect(next.charisma).toBe(5);
    expect(next.fundraising).toBe(5);
    expect(next.energy).toBe(5);
  });

  it("does not decay Debate (bespoke clock)", () => {
    const { stats: next } = applyTurnDrift(stats, undefined);
    expect(next.debate).toBe(5);
  });

  it("flushes use-growth XP and zeroes the ledger", () => {
    const { stats: next, statXp } = applyTurnDrift(stats, { charisma: 0.2 });
    expect(next.charisma).toBeCloseTo(5 + 0.2, 6);
    expect(statXp).toEqual({});
  });

  it("nets positive on a single skill use", () => {
    const { stats: next } = applyTurnDrift(stats, { businessAcumen: USE_GROWTH_INCREMENT });
    expect(next.businessAcumen).toBeCloseTo(5 + USE_GROWTH_INCREMENT, 6);
  });

  it("does not decay neglected stats", () => {
    const { stats: next } = applyTurnDrift(stats, { charisma: 0.1 });
    expect(next.charisma).toBeCloseTo(5 + 0.1, 6); // engaged
    expect(next.fundraising).toBe(5); // neglected, but no decay
  });

  it("lets Energy climb on any activity (no maintenance threshold)", () => {
    const lightXp = USE_GROWTH_INCREMENT;
    const { stats: next } = applyTurnDrift(stats, { energy: lightXp });
    expect(next.energy).toBeCloseTo(5 + lightXp, 6);
  });

  it("lets Energy climb when activity clears the old maintenance threshold", () => {
    const { stats: next } = applyTurnDrift(stats, { energy: ENERGY_MAINTENANCE_XP });
    expect(next.energy).toBeCloseTo(5 + ENERGY_MAINTENANCE_XP, 6);
  });

  it("clamps at the floor", () => {
    const floored: CharacterStats = { ...stats, charisma: 1 };
    const { stats: next } = applyTurnDrift(floored, undefined);
    expect(next.charisma).toBe(1);
  });
});
