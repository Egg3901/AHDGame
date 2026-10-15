import { describe, expect, it } from "vitest";
import {
  IDLE_RETIRE_GRACE_TURNS,
  IDLE_RETIRE_HEADROOM,
  IDLE_RETIRE_RATE,
  IDLE_RETIRE_STRUCTURAL_GRACE_TURNS,
  IDLE_RETIRE_STRUCTURAL_HEADROOM,
  idleCapacityRetirement,
  type IdleCapacityRetirementInput,
} from "./idleCapacityRetirement";

const glut = (over: Partial<IdleCapacityRetirementInput> = {}): IdleCapacityRetirementInput => ({
  plantsEnabled: true,
  mothballed: false,
  activeFraction: 1,
  demandThrottleFactor: 0.15,
  demandFill: 0.87,
  priorStreak: IDLE_RETIRE_GRACE_TURNS,
  rampLambda: 1,
  ...over,
});

describe("idleCapacityRetirement", () => {
  it("retires nothing during the grace period, but counts the streak", () => {
    const r = idleCapacityRetirement(glut({ priorStreak: 0 }));
    expect(r).toEqual({ streak: 1, retireFraction: 0 });
    const last = idleCapacityRetirement(glut({ priorStreak: IDLE_RETIRE_GRACE_TURNS - 1 }));
    expect(last).toEqual({ streak: IDLE_RETIRE_GRACE_TURNS, retireFraction: 0 });
  });

  it("retires a share of the unjustified capacity once the grace has run", () => {
    const r = idleCapacityRetirement(glut());
    expect(r.streak).toBe(IDLE_RETIRE_GRACE_TURNS + 1);
    expect(r.retireFraction).toBeCloseTo(
      IDLE_RETIRE_RATE * (1 - 0.15 * (1 + IDLE_RETIRE_HEADROOM)),
      12
    );
    expect(r.retireFraction).toBeLessThanOrEqual(IDLE_RETIRE_RATE);
  });

  it("converges gradually toward the justified size", () => {
    let capacity = 16_000;
    const sold = 2_000;
    for (let t = 0; t < 200; t++) {
      const throttle = Math.min(1, sold / capacity);
      const r = idleCapacityRetirement(glut({ demandThrottleFactor: throttle }));
      const next = capacity * (1 - r.retireFraction);
      expect(capacity - next).toBeLessThanOrEqual(capacity * IDLE_RETIRE_RATE + 1e-9);
      capacity = next;
    }
    expect(capacity).toBeGreaterThan(sold * (1 + IDLE_RETIRE_HEADROOM) - 1);
    expect(capacity).toBeLessThan(sold * (1 + IDLE_RETIRE_HEADROOM) * 1.2);
  });

  it("resets on a sold-out plant, an unthrottled plant, parked or mothballed capacity", () => {
    expect(idleCapacityRetirement(glut({ demandFill: 1 }))).toEqual({
      streak: 0,
      retireFraction: 0,
    });
    expect(idleCapacityRetirement(glut({ demandThrottleFactor: 1 }))).toEqual({
      streak: 0,
      retireFraction: 0,
    });
    expect(idleCapacityRetirement(glut({ activeFraction: 0.5 }))).toEqual({
      streak: 0,
      retireFraction: 0,
    });
    expect(idleCapacityRetirement(glut({ mothballed: true }))).toEqual({
      streak: 0,
      retireFraction: 0,
    });
    expect(idleCapacityRetirement(glut({ plantsEnabled: false }))).toEqual({
      streak: 0,
      retireFraction: 0,
    });
  });

  it("does nothing without a clearing signal", () => {
    expect(idleCapacityRetirement(glut({ demandFill: null }))).toEqual({
      streak: 0,
      retireFraction: 0,
    });
  });

  it("scales with the plants ramp", () => {
    const full = idleCapacityRetirement(glut()).retireFraction;
    expect(idleCapacityRetirement(glut({ rampLambda: 0 })).retireFraction).toBe(0);
    expect(idleCapacityRetirement(glut({ rampLambda: 0.5 })).retireFraction).toBeCloseTo(
      full / 2,
      12
    );
  });
});

describe("idleCapacityRetirement: NPP engine 6 structural overcapacity", () => {
  // Sold out (fill 1.0) yet held at 40% of capacity by the throttle.
  const soldOut = (over: Partial<IdleCapacityRetirementInput> = {}) =>
    glut({ demandThrottleFactor: 0.4, demandFill: 1, ...over });

  it("leaves a sold-out plant alone without the NPP engine 6 flag", () => {
    expect(idleCapacityRetirement(soldOut({ priorStreak: 100 }))).toEqual({
      streak: 0,
      retireFraction: 0,
    });
  });

  it("counts the structural streak through the longer grace", () => {
    const r = idleCapacityRetirement(
      soldOut({ nppStructural: true, priorStreak: IDLE_RETIRE_STRUCTURAL_GRACE_TURNS - 1 })
    );
    expect(r).toEqual({ streak: IDLE_RETIRE_STRUCTURAL_GRACE_TURNS, retireFraction: 0 });
  });

  it("retires toward the run with the wider headroom once the grace has run", () => {
    const r = idleCapacityRetirement(
      soldOut({ nppStructural: true, priorStreak: IDLE_RETIRE_STRUCTURAL_GRACE_TURNS })
    );
    expect(r.retireFraction).toBeCloseTo(
      IDLE_RETIRE_RATE * (1 - 0.4 * (1 + IDLE_RETIRE_STRUCTURAL_HEADROOM)),
      12
    );
  });

  it("does not fire for a plant running above the structural throttle", () => {
    const r = idleCapacityRetirement(
      soldOut({ nppStructural: true, demandThrottleFactor: 0.8, priorStreak: 100 })
    );
    expect(r).toEqual({ streak: 0, retireFraction: 0 });
  });
});
