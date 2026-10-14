import { describe, expect, it } from "vitest";
import {
  SCARCITY_DRIFT_DECAY,
  SCARCITY_DRIFT_MAX,
  SCARCITY_DRIFT_MIN,
  SCARCITY_DRIFT_STEP,
  SCARCITY_MOMENTUM_HISTORY_TURNS,
  SCARCITY_MOMENTUM_MIN_HISTORY,
  scarcityImbalance,
  updateScarcityMultiplier,
  updateScarcityMultiplierMomentum,
} from "./scarcityDrift";

describe("updateScarcityMultiplier", () => {
  it("ratchets up under persistent shortage (>15% unmet)", () => {
    // energy at t899: 10.75M supplied vs 28.49M demanded (62% unmet)
    const next = updateScarcityMultiplier(1, 10_752_811, 28_490_557);
    expect(next).toBeCloseTo(1 + SCARCITY_DRIFT_STEP, 10);
  });

  it("compounds across turns and caps at SCARCITY_DRIFT_MAX", () => {
    let mult = 1;
    for (let i = 0; i < 10_000; i++) mult = updateScarcityMultiplier(mult, 1, 10);
    expect(mult).toBe(SCARCITY_DRIFT_MAX);
  });

  it("ratchets down under persistent surplus and floors at SCARCITY_DRIFT_MIN", () => {
    let mult = 1;
    mult = updateScarcityMultiplier(mult, 10, 1);
    expect(mult).toBeCloseTo(1 / (1 + SCARCITY_DRIFT_STEP), 10);
    for (let i = 0; i < 10_000; i++) mult = updateScarcityMultiplier(mult, 10, 1);
    expect(mult).toBe(SCARCITY_DRIFT_MIN);
  });

  it("holds neutral inside the dead band (unmet and surplus both <=15%)", () => {
    expect(updateScarcityMultiplier(1, 95, 100)).toBe(1);
    expect(updateScarcityMultiplier(1, 100, 95)).toBe(1);
  });

  it("decays an elevated multiplier toward 1 when the market rebalances", () => {
    const next = updateScarcityMultiplier(1.5, 100, 100);
    expect(next).toBeCloseTo(1 + 0.5 * SCARCITY_DRIFT_DECAY, 10);
    // and snaps to exactly 1 once close enough
    expect(updateScarcityMultiplier(1.0004, 100, 100)).toBe(1);
  });

  it("treats missing/garbage previous values as neutral", () => {
    expect(updateScarcityMultiplier(null, 100, 100)).toBe(1);
    expect(updateScarcityMultiplier(undefined, 100, 100)).toBe(1);
    expect(updateScarcityMultiplier(Number.NaN, 100, 100)).toBe(1);
    expect(updateScarcityMultiplier(-5, 100, 100)).toBe(1);
  });

  it("holds and decays with a dead market (no supply, no demand)", () => {
    expect(updateScarcityMultiplier(1, 0, 0)).toBe(1);
    expect(updateScarcityMultiplier(2, 0, 0)).toBeCloseTo(1 + 1 * SCARCITY_DRIFT_DECAY, 10);
  });

  it("pure shortage with zero supply still ratchets up", () => {
    expect(updateScarcityMultiplier(1, 0, 100)).toBeCloseTo(1 + SCARCITY_DRIFT_STEP, 10);
  });

  // --- #3297: severity-scaled target (mid-range, no railing) ---

  it("a moderate persistent shortage settles at a mid-range, not the cap", () => {
    // 25% unmet (supply 75 / demand 100): well above the 15% ratchet threshold
    // but below the 45% "severe" point → target strictly between 1 and the cap.
    let mult = 1;
    for (let i = 0; i < 5_000; i++) mult = updateScarcityMultiplier(mult, 75, 100);
    // severity = (0.25-0.15)/(0.45-0.15) = 1/3 → target = 1 + 1.5*(1/3) = 1.5
    expect(mult).toBeCloseTo(1.5, 3);
    expect(mult).toBeLessThan(SCARCITY_DRIFT_MAX);
    expect(mult).toBeGreaterThan(1);
  });

  it("a moderate persistent surplus settles above the floor, not at it", () => {
    // 25% surplus (supply 100 / demand 75)
    let mult = 1;
    for (let i = 0; i < 5_000; i++) mult = updateScarcityMultiplier(mult, 100, 75);
    // severity = 1/3 → target = 1 - 0.4*(1/3) ≈ 0.8667
    expect(mult).toBeCloseTo(1 - (1 - SCARCITY_DRIFT_MIN) / 3, 3);
    expect(mult).toBeGreaterThan(SCARCITY_DRIFT_MIN);
    expect(mult).toBeLessThan(1);
  });

  it("de-pins a multiplier railed at the cap once the shortage eases to moderate", () => {
    // A commodity ratcheted to the old hard cap, now facing only a 25% shortage,
    // must drift DOWN off the rail toward its severity target (~1.5).
    let mult = SCARCITY_DRIFT_MAX;
    const afterOne = updateScarcityMultiplier(mult, 75, 100);
    expect(afterOne).toBeLessThan(SCARCITY_DRIFT_MAX); // steps down immediately
    for (let i = 0; i < 5_000; i++) mult = updateScarcityMultiplier(mult, 75, 100);
    expect(mult).toBeCloseTo(1.5, 3);
  });

  it("still reaches the cap under a severe (>=45%) persistent shortage", () => {
    let mult = 1;
    for (let i = 0; i < 10_000; i++) mult = updateScarcityMultiplier(mult, 40, 100); // 60% unmet
    expect(mult).toBe(SCARCITY_DRIFT_MAX);
  });
});

describe("updateScarcityMultiplierMomentum (commodity treadmill fix stage 1)", () => {
  const run = (
    start: number,
    series: Array<[number, number]>,
    history: number[] = []
  ): { multiplier: number; history: number[] } => {
    let state = { multiplier: start, history };
    for (const [supply, demand] of series) {
      state = updateScarcityMultiplierMomentum(state.multiplier, supply, demand, state.history);
    }
    return state;
  };

  it("a pinned residual (demand = 1.5x supply every turn) stops climbing and decays", () => {
    // Level mode marched 2.068 -> 2.5 here. Momentum mode must not step up.
    const series: Array<[number, number]> = Array.from({ length: 40 }, () => [100, 150]);
    const { multiplier, history } = run(2.068, series);
    expect(multiplier).toBeLessThan(2.068);
    expect(history.length).toBe(SCARCITY_MOMENTUM_HISTORY_TURNS);
    // decays at the balanced-turn rate once the trailing reference exists
    const afterRef = run(2.068, series.slice(0, SCARCITY_MOMENTUM_MIN_HISTORY + 1));
    expect(afterRef.multiplier).toBeCloseTo(
      1 + (2.068 - 1) * SCARCITY_DRIFT_DECAY ** (SCARCITY_MOMENTUM_MIN_HISTORY + 1),
      6
    );
  });

  it("keeps the live multiplier on the first turns (no reset step)", () => {
    const next = updateScarcityMultiplierMomentum(2.068, 100, 150, undefined);
    expect(next.multiplier).toBeCloseTo(1 + (2.068 - 1) * SCARCITY_DRIFT_DECAY, 10);
    expect(next.history).toEqual([scarcityImbalance(100, 150)]);
  });

  it("a worsening shortage still steps up toward the severity target", () => {
    const flat: Array<[number, number]> = Array.from({ length: 8 }, () => [100, 120]);
    const base = run(1, flat);
    const worse = updateScarcityMultiplierMomentum(base.multiplier, 100, 200, base.history);
    expect(worse.multiplier).toBeCloseTo(base.multiplier * (1 + SCARCITY_DRIFT_STEP), 10);
  });

  it("an easing shortage steps down toward 1", () => {
    const flat: Array<[number, number]> = Array.from({ length: 8 }, () => [100, 200]);
    const base = run(1.8, flat);
    const easing = updateScarcityMultiplierMomentum(base.multiplier, 100, 140, base.history);
    expect(easing.multiplier).toBeCloseTo(base.multiplier / (1 + SCARCITY_DRIFT_STEP), 10);
  });

  it("a deepening glut steps down toward the glut target, an easing glut steps up", () => {
    const flat: Array<[number, number]> = Array.from({ length: 8 }, () => [120, 100]);
    const base = run(0.8, flat);
    const deeper = updateScarcityMultiplierMomentum(base.multiplier, 200, 100, base.history);
    expect(deeper.multiplier).toBeCloseTo(base.multiplier / (1 + SCARCITY_DRIFT_STEP), 10);
    const easing = updateScarcityMultiplierMomentum(base.multiplier, 105, 100, base.history);
    expect(easing.multiplier).toBeCloseTo(base.multiplier * (1 + SCARCITY_DRIFT_STEP), 10);
  });

  it("never leaves the hard bounds and drops garbage history", () => {
    const { multiplier, history } = run(SCARCITY_DRIFT_MAX, [[0, 100]], [Number.NaN, 0.1]);
    expect(multiplier).toBeLessThanOrEqual(SCARCITY_DRIFT_MAX);
    expect(history.every((v) => Number.isFinite(v))).toBe(true);
    expect(run(SCARCITY_DRIFT_MIN, [[100, 0]]).multiplier).toBeGreaterThanOrEqual(
      SCARCITY_DRIFT_MIN
    );
  });
});
