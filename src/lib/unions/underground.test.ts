import { describe, expect, it } from "vitest";
import {
  EXPOSURE_LENGTH_TURNS,
  HEAT_DETECTION_THRESHOLD,
  UNDERGROUND_ACTION_COST,
  UNDERGROUND_MASS_HEAT,
  UNDERGROUND_MASS_STRENGTH_GAIN,
  UNDERGROUND_QUIET_HEAT,
  UNDERGROUND_QUIET_STRENGTH_GAIN,
  approvalHeatMultiplier,
  decayUndergroundHeat,
  repealUndergroundConversion,
  resolveUndergroundDrive,
  rollUndergroundDetectionOutcome,
  undergroundDetectionChance,
  undergroundHeat,
  undergroundHeatText,
  undergroundStatus,
  undergroundStrength,
} from "./underground";
import { ORGANIZE_ACTION_COST } from "./unionEconomy";

describe("underground tunables", () => {
  it("costs 2x a legal drive in action points, never treasury", () => {
    expect(UNDERGROUND_ACTION_COST).toBe(ORGANIZE_ACTION_COST * 2);
  });
});

describe("undergroundStrength / undergroundHeat", () => {
  it("reads missing shadow fields as zero and clamps heat to 0-100", () => {
    expect(undergroundStrength({})).toBe(0);
    expect(undergroundHeat({})).toBe(0);
    expect(undergroundHeat({ heat: 140 })).toBe(100);
    expect(undergroundHeat({ heat: -3 })).toBe(0);
  });
});

describe("undergroundStatus", () => {
  it("is dark below threshold, suspected at threshold, exposed inside the window", () => {
    expect(undergroundStatus({}, 10)).toBe("dark");
    expect(undergroundStatus({ heat: HEAT_DETECTION_THRESHOLD - 1 }, 10)).toBe("dark");
    expect(undergroundStatus({ heat: HEAT_DETECTION_THRESHOLD }, 10)).toBe("suspected");
    expect(undergroundStatus({ heat: 0, exposedUntilTurn: 12 }, 10)).toBe("exposed");
  });

  it("goes dark again once the exposure window passes, with no permanent flag", () => {
    expect(
      undergroundStatus({ heat: 0, exposedUntilTurn: 10 }, 10 + EXPOSURE_LENGTH_TURNS + 1)
    ).toBe("dark");
  });
});

describe("undergroundHeatText", () => {
  it("stays vague: cold / warm / hot brackets, never the number", () => {
    expect(undergroundHeatText({ heat: 0 })).toBe("cold");
    expect(undergroundHeatText({ heat: 15 })).toBe("warm");
    expect(undergroundHeatText({ heat: 90 })).toBe("hot");
  });
});

describe("resolveUndergroundDrive", () => {
  it("quiet is slow and cool, mass is fast and hot", () => {
    const quiet = resolveUndergroundDrive({ mode: "quiet", approval: 70, exposed: false });
    const mass = resolveUndergroundDrive({ mode: "mass", approval: 70, exposed: false });
    expect(quiet.strengthGain).toBe(UNDERGROUND_QUIET_STRENGTH_GAIN);
    expect(mass.strengthGain).toBe(UNDERGROUND_MASS_STRENGTH_GAIN);
    expect(quiet.heat).toBe(UNDERGROUND_QUIET_HEAT);
    expect(mass.heat).toBe(UNDERGROUND_MASS_HEAT);
    expect(mass.strengthGain).toBeGreaterThan(quiet.strengthGain);
    expect(mass.heat).toBeGreaterThan(quiet.heat);
  });

  it("halves efficiency while exposed but still adds heat", () => {
    const dark = resolveUndergroundDrive({ mode: "mass", approval: 70, exposed: false });
    const exposed = resolveUndergroundDrive({ mode: "mass", approval: 70, exposed: true });
    expect(exposed.strengthGain).toBe(dark.strengthGain / 2);
    expect(exposed.heat).toBe(dark.heat);
  });

  it("low approval pays more heat per point of progress", () => {
    const loved = resolveUndergroundDrive({ mode: "quiet", approval: 80, exposed: false });
    const resented = resolveUndergroundDrive({ mode: "quiet", approval: 20, exposed: false });
    expect(resented.heat).toBeGreaterThan(loved.heat);
    expect(resented.strengthGain).toBe(loved.strengthGain);
    expect(approvalHeatMultiplier(70)).toBe(1);
    expect(approvalHeatMultiplier(20)).toBeGreaterThan(1);
  });
});

describe("undergroundDetectionChance", () => {
  it("is zero below threshold and scales with heat above it", () => {
    expect(undergroundDetectionChance(HEAT_DETECTION_THRESHOLD - 1)).toBe(0);
    const at = undergroundDetectionChance(HEAT_DETECTION_THRESHOLD);
    const hotter = undergroundDetectionChance(HEAT_DETECTION_THRESHOLD + 10);
    expect(at).toBeGreaterThan(0);
    expect(hotter).toBeGreaterThan(at);
    expect(undergroundDetectionChance(100)).toBeLessThanOrEqual(60);
  });

  it("pairs with a pure roll outcome so tests stay deterministic", () => {
    expect(rollUndergroundDetectionOutcome(0, 1)).toBe(false);
    expect(rollUndergroundDetectionOutcome(50, 50)).toBe(true);
    expect(rollUndergroundDetectionOutcome(50, 51)).toBe(false);
  });
});

describe("decayUndergroundHeat", () => {
  it("bleeds slowly and never below zero", () => {
    expect(decayUndergroundHeat(10)).toBe(8);
    expect(decayUndergroundHeat(1)).toBe(0);
    expect(decayUndergroundHeat(0)).toBe(0);
  });
});

describe("repealUndergroundConversion", () => {
  it("converts the shadow pool at a haircut", () => {
    expect(repealUndergroundConversion(100)).toBe(50);
    expect(repealUndergroundConversion(0)).toBe(0);
    expect(repealUndergroundConversion(-5)).toBe(0);
  });
});
