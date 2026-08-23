import { describe, expect, it } from "vitest";
import {
  clampTension,
  stepTension,
  tensionBand,
  tensionFloor,
  tensionPressureBreakdown,
  TENSION_BASELINE,
} from "./tension";

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
    expect(tensionFloor({ escalationLevel: 0, activeCrises: 0, totalWarheads: 0 })).toBe(
      TENSION_BASELINE
    );
  });

  it("explains every contribution to the same floor players see", () => {
    const breakdown = tensionPressureBreakdown({
      escalationLevel: 2,
      activeCrises: 3,
      totalWarheads: 100,
    });
    expect(breakdown).toEqual({
      baseline: 12,
      escalation: 8,
      activeCrises: 9,
      arsenal: 12,
      floor: 41,
    });
    expect(tensionFloor({ escalationLevel: 2, activeCrises: 3, totalWarheads: 100 })).toBe(
      breakdown.floor
    );
  });

  it("rises with escalation, crises and arsenals, each capped", () => {
    const hot = tensionFloor({ escalationLevel: 99, activeCrises: 99, totalWarheads: 1e6 });
    expect(hot).toBe(TENSION_BASELINE + 30 + 12 + 18);
  });
});

describe("stepTension", () => {
  const quiet = { escalationLevel: 0, activeCrises: 0, totalWarheads: 0 };

  it("decays a spike toward the floor without overshooting", () => {
    const next = stepTension(80, quiet);
    expect(next).toBeLessThan(80);
    expect(next).toBeGreaterThan(TENSION_BASELINE);
  });

  it("rises toward a higher floor when standing pressure exceeds the value", () => {
    const hot = { escalationLevel: 5, activeCrises: 2, totalWarheads: 100 };
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
