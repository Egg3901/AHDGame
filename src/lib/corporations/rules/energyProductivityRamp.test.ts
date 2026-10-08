import { describe, expect, it } from "vitest";
import {
  ENERGY_PRODUCTIVITY_RAMP_BY_PRESET,
  energyProductivityMultiplier,
  plantUtilizationForInputs,
} from "./energyProductivityRamp";

const PRESET = "1991-default";
const ramp = ENERGY_PRODUCTIVITY_RAMP_BY_PRESET[PRESET]!;

describe("energyProductivityMultiplier", () => {
  it("is exactly 1 at and before the start turn", () => {
    expect(energyProductivityMultiplier("energy", 0, PRESET)).toBe(1);
    expect(energyProductivityMultiplier("energy", ramp.startTurn, PRESET)).toBe(1);
  });

  it("rises with no step larger than gain / rampTurns", () => {
    const step = ramp.gain / ramp.rampTurns;
    let prev = 1;
    for (let t = ramp.startTurn; t <= ramp.startTurn + ramp.rampTurns + 5; t++) {
      const m = energyProductivityMultiplier("energy", t, PRESET);
      expect(m).toBeGreaterThanOrEqual(prev);
      expect(m - prev).toBeLessThanOrEqual(step + 1e-12);
      prev = m;
    }
  });

  it("reaches 1 + gain after one game year and holds at the cap", () => {
    const end = ramp.startTurn + ramp.rampTurns;
    expect(energyProductivityMultiplier("energy", end, PRESET)).toBeCloseTo(1 + ramp.gain, 12);
    expect(energyProductivityMultiplier("energy", end + 1000, PRESET)).toBeCloseTo(
      1 + ramp.gain,
      12
    );
    expect(ramp.gain).toBeGreaterThanOrEqual(0.25);
    expect(ramp.gain).toBeLessThanOrEqual(0.4);
    expect(ramp.rampTurns).toBe(48);
  });

  it("is halfway at the midpoint", () => {
    const mid = ramp.startTurn + ramp.rampTurns / 2;
    expect(energyProductivityMultiplier("energy", mid, PRESET)).toBeCloseTo(1 + ramp.gain / 2, 12);
  });

  it("is a pure function of turn: same inputs, same output", () => {
    const a = energyProductivityMultiplier("energy", 100, PRESET);
    const b = energyProductivityMultiplier("energy", 100, PRESET);
    expect(a).toBe(b);
  });

  it("ignores other sectors, other presets and bad turns", () => {
    expect(energyProductivityMultiplier("manufacturing", 500, PRESET)).toBe(1);
    expect(energyProductivityMultiplier("energy", 500, "2019-default")).toBe(1);
    expect(energyProductivityMultiplier("energy", 500, undefined)).toBe(1);
    expect(energyProductivityMultiplier("energy", Number.NaN, PRESET)).toBe(1);
    expect(energyProductivityMultiplier("energy", undefined, PRESET)).toBe(1);
  });
});

describe("plantUtilizationForInputs", () => {
  it("keeps the legacy cap of 1 without a productivity multiplier", () => {
    expect(plantUtilizationForInputs(120, 100)).toBe(1);
    expect(plantUtilizationForInputs(60, 100)).toBeCloseTo(0.6, 12);
    expect(plantUtilizationForInputs(-5, 100)).toBe(0);
  });

  it("lets input demand follow output up to the multiplier", () => {
    expect(plantUtilizationForInputs(120, 100, 1.3)).toBeCloseTo(1.2, 12);
    expect(plantUtilizationForInputs(150, 100, 1.3)).toBeCloseTo(1.3, 12);
  });

  it("holds inputs per unit of output constant as the ramp lifts output", () => {
    const capacity = 100;
    const base = 0.96;
    for (const m of [1, 1.1, 1.3]) {
      const produced = capacity * base * m;
      expect(plantUtilizationForInputs(produced, capacity, m) / produced).toBeCloseTo(
        1 / capacity,
        12
      );
    }
  });
});
