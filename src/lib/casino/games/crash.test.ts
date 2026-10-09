import { describe, expect, it } from "vitest";
import { CRASH_HOUSE_EDGE, drawCrashPoint, playCrash } from "./crash";

describe("crash", () => {
  it("survives a target with probability (1 - edge) / target", () => {
    // Integrate over a fine uniform grid instead of sampling.
    const steps = 200_000;
    for (const target of [1.01, 2, 10, 100]) {
      let ev = 0;
      for (let i = 0; i < steps; i++) ev += playCrash(() => (i + 0.5) / steps, target).multiplier;
      expect(ev / steps).toBeCloseTo(1 - CRASH_HOUSE_EDGE, 2);
    }
  });

  it("floors at 1.00x and reports the target on a win", () => {
    expect(drawCrashPoint(() => 0)).toBe(1);
    expect(playCrash(() => 0.9, 5)).toMatchObject({ target: 5, won: true, multiplier: 5 });
    expect(playCrash(() => 0.5, 2)).toMatchObject({ crashPoint: 1.92, won: false, multiplier: 0 });
  });
});
