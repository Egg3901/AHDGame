import { describe, expect, it } from "vitest";
import {
  SCARCITY_DRIFT_DECAY,
  SCARCITY_DRIFT_MAX,
  SCARCITY_DRIFT_MIN,
  SCARCITY_DRIFT_STEP,
  updateScarcityMultiplier,
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
