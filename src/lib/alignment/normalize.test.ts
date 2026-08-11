import { describe, expect, it } from "vitest";
import type { AlignmentPoleId } from "@/lib/constants/alignmentEras";
import { normalizeShares } from "./normalize";

const TWO: AlignmentPoleId[] = ["WEST", "EAST"];
const THREE: AlignmentPoleId[] = ["WASHINGTON", "MOSCOW", "BEIJING"];

/** The invariant every result must satisfy, whatever the input. */
/** A share must land on a hundredth — tolerant, since 0.01 is not exact in binary. */
function isWholeUnit(v: number): boolean {
  return Math.abs(v * 100 - Math.round(v * 100)) < 1e-9;
}

function expectInvariant(r: {
  shares: Partial<Record<AlignmentPoleId, number>>;
  nonAligned: number;
}) {
  const values = Object.values(r.shares) as number[];
  for (const v of values) {
    expect(isWholeUnit(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(100);
  }
  expect(isWholeUnit(r.nonAligned)).toBe(true);
  expect(r.nonAligned).toBeGreaterThanOrEqual(0);
  // Exact in tenths; the decimal sum carries floating-point dust because a tenth
  // has no exact binary form, which is precisely why the maths runs in integers.
  expect(values.reduce((a, b) => a + b, 0) + r.nonAligned).toBeCloseTo(100, 9);
}

describe("normalizeShares", () => {
  it("passes a well-formed row through unchanged", () => {
    const r = normalizeShares({ WEST: 22, EAST: 50 }, TWO);
    expect(r.shares).toEqual({ WEST: 22, EAST: 50 });
    expect(r.nonAligned).toBe(28);
    expectInvariant(r);
  });

  it("clamps negatives to zero", () => {
    const r = normalizeShares({ WEST: -30, EAST: 40 }, TWO);
    expect(r.shares.WEST).toBe(0);
    expect(r.shares.EAST).toBe(40);
    expectInvariant(r);
  });

  it("scales an over-100 row proportionally, preserving the ordering", () => {
    const r = normalizeShares({ WEST: 80, EAST: 60 }, TWO);
    expect(r.nonAligned).toBe(0);
    expectInvariant(r);
    // 100/140 -> 57.14/42.86. At whole points this was 57/43 and at tenths
    // 57.1/42.9; each step of resolution lands it closer to the true
    // proportion. The dominant pole stays dominant either way: equalising
    // (50/50) or shaving only the top (40/60) would lose or invert the
    // relative standing.
    expect(r.shares.WEST).toBeCloseTo(57.14, 9);
    expect(r.shares.EAST).toBeCloseTo(42.86, 9);
    expect(r.shares.WEST!).toBeGreaterThan(r.shares.EAST!);
  });

  it("never reorders poles when scaling three of them", () => {
    const r = normalizeShares({ WASHINGTON: 60, MOSCOW: 40, BEIJING: 30 }, THREE);
    expectInvariant(r);
    expect(r.shares.WASHINGTON!).toBeGreaterThan(r.shares.MOSCOW!);
    expect(r.shares.MOSCOW!).toBeGreaterThan(r.shares.BEIJING!);
    expect(r.nonAligned).toBe(0);
  });

  it("keeps a hundredth exactly, rather than rounding it away", () => {
    // This is the point of the resolution: a value finer than a tenth survives
    // the write instead of collapsing. Membership drift is 0.04 a turn, which
    // the old tenth grid rounded to nothing every turn — the lever was inert
    // while looking implemented.
    const r = normalizeShares({ WEST: 33.34, EAST: 33.33 }, TWO);
    expectInvariant(r);
    expect(r.shares.WEST).toBeCloseTo(33.34, 9);
    expect(r.shares.EAST).toBeCloseTo(33.33, 9);
    expect(r.nonAligned).toBeCloseTo(33.33, 9);
  });

  it("accumulates a sub-tenth effect across turns instead of losing it", () => {
    // The failure mode the resolution exists to prevent: re-rounding each turn
    // meant a recurring effect below the grid was not "slow", it was nothing at
    // all, forever.
    let r = normalizeShares({ WEST: 40, EAST: 10 }, TWO);
    for (let turn = 0; turn < 25; turn++) {
      r = normalizeShares({ WEST: (r.shares.WEST ?? 0) + 0.04, EAST: r.shares.EAST ?? 0 }, TWO);
      expectInvariant(r);
    }
    expect(r.shares.WEST).toBeCloseTo(41, 9);
  });

  it("still rounds away anything finer than a hundredth", () => {
    // A thousandth is below the resolution and must not survive, or the exact
    // total could not be maintained.
    const r = normalizeShares({ WEST: 33.334, EAST: 33.335 }, TWO);
    expectInvariant(r);
    expect(r.shares.WEST).toBeCloseTo(33.33, 9);
    expect(r.shares.EAST).toBeCloseTo(33.34, 9);
  });

  it("treats an empty input as fully non-aligned", () => {
    const r = normalizeShares({}, TWO);
    expect(r.nonAligned).toBe(100);
    expectInvariant(r);
  });

  it("drops poles that do not exist in the given set", () => {
    // BEIJING has no meaning in a two-pole world; it must not survive.
    const r = normalizeShares({ WEST: 20, EAST: 20, BEIJING: 40 }, TWO);
    expect(r.shares.BEIJING).toBeUndefined();
    expect(r.nonAligned).toBe(60);
    expectInvariant(r);
  });

  it("holds the invariant across three poles", () => {
    const r = normalizeShares({ WASHINGTON: 40, MOSCOW: 16, BEIJING: 8 }, THREE);
    // What no bloc holds IS the non-aligned share.
    expect(r.nonAligned).toBe(36);
    expectInvariant(r);
  });

  it("survives non-finite input", () => {
    const r = normalizeShares({ WEST: Number.NaN, EAST: Number.POSITIVE_INFINITY }, TWO);
    expectInvariant(r);
  });

  it("never returns a share for a pole absent from the set, even at 0", () => {
    const r = normalizeShares({ WEST: 50 }, TWO);
    expect(Object.keys(r.shares).sort()).toEqual(["EAST", "WEST"]);
    expect(r.shares.EAST).toBe(0);
  });
  it("keeps derived values correct, not merely close", async () => {
    // A hundredth has no exact binary form, so a raw subtraction of two clean
    // shares yields 0.30000000000000071. Harmless for a comparison, fatal at a
    // gate boundary — so every derived quantity snaps back to the grid.
    const { roundToShareGrid } = await import("./normalize");
    const { leadFor } = await import("./project");

    const raw = 33.4 - 33.1;
    expect(String(raw)).not.toBe("0.3"); // the hazard is real, not hypothetical
    expect(roundToShareGrid(raw)).toBe(0.3);

    const lead = leadFor(normalizeShares({ WEST: 33.4, EAST: 33.1 }, TWO));
    expect(lead).toBe(0.3);
  });

  it("writes every share with both decimals, so a moving nation looks like one", async () => {
    // Drift is 0.04 a turn. Trimmed to "56", a nation that has just moved to
    // 56.04 reads as a formatting glitch rather than as movement — and one
    // sitting still would look identical to one creeping toward a gate.
    const { formatShare, formatShareDelta } = await import("./normalize");
    expect(formatShare(56)).toBe("56.00");
    expect(formatShare(56.04)).toBe("56.04");
    expect(formatShare(0)).toBe("0.00");
    expect(formatShareDelta(0.04)).toBe("+0.04");
    expect(formatShareDelta(-0.04)).toBe("-0.04");
    expect(formatShareDelta(0)).toBe("0.00");
  });
});
