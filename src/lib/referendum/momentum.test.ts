import { describe, it, expect } from "vitest";
import { computeReferendumMomentum } from "./momentum";

describe("computeReferendumMomentum", () => {
  it("returns null with fewer than two points", () => {
    expect(computeReferendumMomentum([])).toBeNull();
    expect(computeReferendumMomentum([{ turn: 1, yesShare: 50 }])).toBeNull();
    expect(computeReferendumMomentum(undefined)).toBeNull();
  });

  it("rising recent swing → up, with recent and since-open deltas", () => {
    const h = [
      { turn: 1, yesShare: 50 },
      { turn: 2, yesShare: 51 },
      { turn: 3, yesShare: 52 },
      { turn: 4, yesShare: 53 },
      { turn: 5, yesShare: 56 },
    ];
    const m = computeReferendumMomentum(h, { lookback: 3 })!;
    expect(m.direction).toBe("up");
    // latest 56 vs reading at/below turn 5-3=2 (=51) → +5 recent
    expect(m.recentDelta).toBeCloseTo(5);
    expect(m.totalDelta).toBeCloseTo(6); // 56 − 50
    expect(m.latest).toBe(56);
  });

  it("falling recent swing → down", () => {
    const h = [
      { turn: 10, yesShare: 60 },
      { turn: 11, yesShare: 58 },
      { turn: 12, yesShare: 55 },
    ];
    expect(computeReferendumMomentum(h, { lookback: 3 })!.direction).toBe("down");
  });

  it("within the flat threshold → flat", () => {
    const h = [
      { turn: 1, yesShare: 50 },
      { turn: 2, yesShare: 50.3 },
    ];
    expect(computeReferendumMomentum(h, { lookback: 3, flatThreshold: 0.5 })!.direction).toBe(
      "flat"
    );
  });

  it("falls back to the first reading when none is old enough for the lookback", () => {
    const h = [
      { turn: 8, yesShare: 50 },
      { turn: 9, yesShare: 54 },
    ];
    // turn 9 − 3 = 6; no reading ≤ 6 → ref is the first point (50) → +4 recent.
    expect(computeReferendumMomentum(h, { lookback: 3 })!.recentDelta).toBeCloseTo(4);
  });
});
