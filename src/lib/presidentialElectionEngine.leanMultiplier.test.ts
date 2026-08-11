/**
 * Unit tests for the state/district lean vote multiplier (#3243).
 *
 * The old shape (coefficient 0.25, floor 0.5, no ceiling) double-counted
 * state partisanship — appeal is already computed from the same substrate
 * leans — and turned a lean −2 state into a 3:1 hammer (Dem ×1.5 / Rep ×0.5).
 * The new shape (state coefficient 0.10, clamp [0.8, 1.2]) keeps the
 * winner-take-all geography signal at tiebreaker scale: at most 1.5:1.
 */
import { describe, it, expect } from "vitest";
import {
  leanVoteMultiplier,
  LEAN_MULT_MAX,
  LEAN_MULT_MIN,
  STATE_LEAN_STRENGTH,
  DISTRICT_LEAN_STRENGTH,
} from "./presidentialElectionEngine";

describe("leanVoteMultiplier (#3243)", () => {
  it("lean −2 state: left candidate ×1.2, right candidate ×0.8 (1.5:1, was 3:1)", () => {
    // epSign: −1 for a left-positioned candidate, +1 for a right-positioned one.
    const dem = leanVoteMultiplier(-2, -1, false);
    const rep = leanVoteMultiplier(-2, 1, false);
    expect(dem).toBeCloseTo(1.2, 10);
    expect(rep).toBeCloseTo(0.8, 10);
    expect(dem / rep).toBeCloseTo(1.5, 10);
    // Old behavior for reference: 1 + (−2)(−1)(0.25) = 1.5 and
    // max(0.5, 1 + (−2)(1)(0.25)) = 0.5 → a 3:1 ratio. Must not come back.
    expect(dem / rep).toBeLessThan(3);
  });

  it("is symmetric for a lean +2 state", () => {
    expect(leanVoteMultiplier(2, 1, false)).toBeCloseTo(1.2, 10);
    expect(leanVoteMultiplier(2, -1, false)).toBeCloseTo(0.8, 10);
  });

  it("clamps extreme leans to the [0.8, 1.2] band", () => {
    // Derived state leans span roughly −2.5..+2.5; clamp guards the tails.
    expect(leanVoteMultiplier(5, 1, false)).toBe(LEAN_MULT_MAX);
    expect(leanVoteMultiplier(-5, 1, false)).toBe(LEAN_MULT_MIN);
    expect(leanVoteMultiplier(2.5, 1, false)).toBe(LEAN_MULT_MAX);
    expect(leanVoteMultiplier(-2.5, 1, false)).toBe(LEAN_MULT_MIN);
  });

  it("is tiebreaker-scale inside the band (coefficient 0.10)", () => {
    expect(STATE_LEAN_STRENGTH).toBe(0.1);
    expect(leanVoteMultiplier(1, 1, false)).toBeCloseTo(1.1, 10);
    expect(leanVoteMultiplier(-1, 1, false)).toBeCloseTo(0.9, 10);
    expect(leanVoteMultiplier(0.5, -1, false)).toBeCloseTo(0.95, 10);
  });

  it("neutral cases are exactly 1", () => {
    expect(leanVoteMultiplier(0, 1, false)).toBe(1);
    expect(leanVoteMultiplier(-2, 0, false)).toBe(1); // centrist candidate
  });

  it("ME/NE district leans keep coefficient 0.3 but stay well inside the clamp", () => {
    expect(DISTRICT_LEAN_STRENGTH).toBe(0.3);
    // UNIT_LEAN spans ±0.25 → band [0.925, 1.075].
    expect(leanVoteMultiplier(0.25, 1, true)).toBeCloseTo(1.075, 10);
    expect(leanVoteMultiplier(-0.25, 1, true)).toBeCloseTo(0.925, 10);
    expect(leanVoteMultiplier(0.25, 1, true)).toBeLessThanOrEqual(LEAN_MULT_MAX);
  });

  it("never exceeds a 1.5:1 two-party ratio for any state lean", () => {
    for (const lean of [-5, -3, -2.5, -1, 0, 1, 2.5, 3, 5]) {
      const left = leanVoteMultiplier(lean, -1, false);
      const right = leanVoteMultiplier(lean, 1, false);
      const ratio = Math.max(left, right) / Math.min(left, right);
      expect(ratio).toBeLessThanOrEqual(1.5 + 1e-9);
    }
  });
});
