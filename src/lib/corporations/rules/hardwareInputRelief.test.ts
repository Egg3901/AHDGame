import { describe, expect, it } from "vitest";
import { hardwareInputMultiplier } from "./hardwareInputRelief";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";

describe("hardware input relief", () => {
  it("advances linearly for twelve turns and holds at fifteen percent", () => {
    expect(hardwareInputMultiplier("technology", "hardware", 219, 219)).toBe(1);
    expect(hardwareInputMultiplier("technology", "hardware", 220, 219)).toBeCloseTo(0.9875);
    expect(hardwareInputMultiplier("technology", "hardware", 225, 219)).toBeCloseTo(0.925);
    expect(hardwareInputMultiplier("technology", "hardware", 231, 219)).toBe(0.85);
    expect(hardwareInputMultiplier("technology", "hardware", 400, 219)).toBe(0.85);
  });
  it("requires a valid world activation and only changes hardware", () => {
    for (const start of [undefined, null, NaN, Infinity, -1]) {
      expect(hardwareInputMultiplier("technology", "hardware", 300, start)).toBe(1);
    }
    expect(hardwareInputMultiplier("technology", "software", 300, 219)).toBe(1);
    expect(hardwareInputMultiplier("manufacturing", "hardware", 300, 219)).toBe(1);
    expect(hardwareInputMultiplier("technology", "hardware", 200, 219)).toBe(1);
    expect(hardwareInputMultiplier("technology", "hardware", NaN, 219)).toBe(1);
  });
  it("reduces every hardware requirement while preserving output", () => {
    const old = getEffectiveStrategyRates("technology", "hardware", null, null, 231);
    const next = getEffectiveStrategyRates(
      "technology",
      "hardware",
      null,
      null,
      231,
      undefined,
      undefined,
      219
    );
    expect(next.supply).toEqual(old.supply);
    for (const [key, rate] of Object.entries(old.demand)) {
      expect(next.demand[key as keyof typeof next.demand]).toBeCloseTo(rate! * 0.85);
    }
  });
  it("blends the relieved hardware leg during transitions in both directions", () => {
    const hw = getEffectiveStrategyRates(
      "technology",
      "hardware",
      null,
      null,
      231,
      undefined,
      undefined,
      219
    );
    const sw = getEffectiveStrategyRates(
      "technology",
      "software",
      null,
      null,
      231,
      undefined,
      undefined,
      219
    );
    for (const [to, from] of [
      ["hardware", "software"],
      ["software", "hardware"],
    ]) {
      const next = getEffectiveStrategyRates(
        "technology",
        to!,
        from!,
        225,
        231,
        undefined,
        undefined,
        219
      );
      expect(next.demand.energy).toBeCloseTo(
        ((hw.demand.energy ?? 0) + (sw.demand.energy ?? 0)) / 2
      );
      expect(next.demand.rare_earth).toBeCloseTo((hw.demand.rare_earth ?? 0) / 2);
    }
  });
});
