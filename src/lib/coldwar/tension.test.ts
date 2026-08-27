import { describe, expect, it } from "vitest";
import {
  clampTension,
  isSuperpowerClash,
  stepTension,
  tensionBand,
  tensionFloor,
  tensionPressureBreakdown,
  warPressures,
  TENSION_BASELINE,
} from "./tension";

const NO_WARS = { superpowerWarIntensity: 0, otherWarIntensity: 0 };

describe("tensionBand", () => {
  it("maps the full range to the five bands", () => {
    expect(tensionBand(5)).toBe("DETENTE");
    expect(tensionBand(20)).toBe("CALM");
    expect(tensionBand(50)).toBe("ELEVATED");
    expect(tensionBand(70)).toBe("CRISIS");
    expect(tensionBand(90)).toBe("BRINK");
  });
});

describe("tensionFloor", () => {
  it("is the baseline in a quiet, disarmed world", () => {
    expect(
      tensionFloor({ escalationLevel: 0, activeCrises: 0, totalWarheads: 0, ...NO_WARS })
    ).toBe(TENSION_BASELINE);
  });

  it("explains every contribution to the same floor players see", () => {
    const breakdown = tensionPressureBreakdown({
      escalationLevel: 2,
      activeCrises: 3,
      totalWarheads: 100,
      ...NO_WARS,
    });
    expect(breakdown).toEqual({
      baseline: 12,
      escalation: 8,
      activeCrises: 9,
      arsenal: 12,
      wars: 0,
      floor: 41,
    });
    expect(
      tensionFloor({ escalationLevel: 2, activeCrises: 3, totalWarheads: 100, ...NO_WARS })
    ).toBe(breakdown.floor);
  });

  it("rises with escalation, crises, arsenals and wars, each capped", () => {
    const hot = tensionFloor({
      escalationLevel: 99,
      activeCrises: 99,
      totalWarheads: 1e6,
      superpowerWarIntensity: 999,
      otherWarIntensity: 999,
    });
    // 12 + 30 + 12 + 18 + 45 = 117, clamped to the scale's ceiling.
    expect(hot).toBe(100);
  });

  it("a superpower shooting war alone parks the floor in CRISIS", () => {
    const floor = tensionFloor({
      escalationLevel: 0,
      activeCrises: 0,
      totalWarheads: 400,
      superpowerWarIntensity: 70,
      otherWarIntensity: 0,
    });
    // 12 baseline + 18 arsenal cap-ish + 31.5 war term.
    expect(floor).toBeGreaterThanOrEqual(60);
    expect(tensionBand(floor)).toBe("CRISIS");
  });

  it("weighs a proxy war far lighter than a superpower clash of equal intensity", () => {
    const base = { escalationLevel: 0, activeCrises: 0, totalWarheads: 0 };
    const clash = tensionPressureBreakdown({
      ...base,
      superpowerWarIntensity: 70,
      otherWarIntensity: 0,
    }).wars;
    const proxy = tensionPressureBreakdown({
      ...base,
      superpowerWarIntensity: 0,
      otherWarIntensity: 70,
    }).wars;
    expect(clash).toBeGreaterThan(proxy * 3);
  });
});

describe("warPressures", () => {
  it("splits superpower clashes from every other war", () => {
    const result = warPressures([
      { sideACountries: ["US"], sideBCountries: ["DD", "RU"], intensity: 70 },
      { sideACountries: ["UK"], sideBCountries: ["EG"], intensity: 40 },
    ]);
    expect(result).toEqual({ superpowerWarIntensity: 70, otherWarIntensity: 40 });
  });

  it("detects the clash in either side order", () => {
    expect(isSuperpowerClash({ sideACountries: ["RU"], sideBCountries: ["US"] })).toBe(true);
    expect(isSuperpowerClash({ sideACountries: ["US", "UK"], sideBCountries: ["RU"] })).toBe(true);
  });

  it("both superpowers on the SAME side is not a clash", () => {
    expect(isSuperpowerClash({ sideACountries: ["US", "RU"], sideBCountries: ["DE"] })).toBe(false);
  });

  it("clamps intensity into [0, 100] per war", () => {
    const result = warPressures([
      { sideACountries: ["US"], sideBCountries: ["RU"], intensity: 250 },
      { sideACountries: ["UK"], sideBCountries: ["EG"], intensity: -10 },
    ]);
    expect(result).toEqual({ superpowerWarIntensity: 100, otherWarIntensity: 0 });
  });
});

describe("stepTension", () => {
  const quiet = { escalationLevel: 0, activeCrises: 0, totalWarheads: 0, ...NO_WARS };

  it("decays a spike toward the floor without overshooting", () => {
    const next = stepTension(80, quiet);
    expect(next).toBeLessThan(80);
    expect(next).toBeGreaterThan(TENSION_BASELINE);
  });

  it("rises toward a higher floor when standing pressure exceeds the value", () => {
    const hot = { escalationLevel: 5, activeCrises: 2, totalWarheads: 100, ...NO_WARS };
    const next = stepTension(TENSION_BASELINE, hot);
    expect(next).toBeGreaterThan(TENSION_BASELINE);
    expect(next).toBeLessThanOrEqual(tensionFloor(hot));
  });

  it("is a fixed point exactly at the floor", () => {
    expect(stepTension(TENSION_BASELINE, quiet)).toBe(TENSION_BASELINE);
  });
});

describe("clampTension", () => {
  it("clamps to [0, 100]", () => {
    expect(clampTension(-5)).toBe(0);
    expect(clampTension(120)).toBe(100);
    expect(clampTension(33.33)).toBe(33.3);
  });
});
