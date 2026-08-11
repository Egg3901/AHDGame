import { describe, expect, it } from "vitest";
import type { AlignmentPoleId } from "@/lib/constants/alignmentEras";
import type { NationStanding } from "./nationStanding";
import { computeWorldBalance } from "./worldBalance";

const POLES: AlignmentPoleId[] = ["WEST", "EAST"];

const stand = (entityId: string, west: number, east: number): NationStanding =>
  ({
    entityId,
    name: entityId,
    isPlayable: true,
    shares: { WEST: west, EAST: east },
    nonAligned: 100 - west - east,
    previousShares: null,
    axis: west - east,
    lead: Math.abs(west - east),
    status: "contested",
    topPoleId: west >= east ? "WEST" : "EAST",
    trend: null,
  }) as NationStanding;

const total = (w: { shares: Partial<Record<AlignmentPoleId, number>>; nonAligned: number }) =>
  POLES.reduce((sum, p) => sum + (w.shares[p] ?? 0), 0) + w.nonAligned;

describe("computeWorldBalance", () => {
  it("weights by nation, one nation one vote", () => {
    const b = computeWorldBalance([stand("A", 80, 20), stand("B", 20, 80)], new Map(), POLES)!;
    expect(b.byNations.shares.WEST).toBeCloseTo(50, 6);
    expect(b.byNations.shares.EAST).toBeCloseTo(50, 6);
    expect(b.nationCount).toBe(2);
  });

  it("weights by economy, so a large economy dominates", () => {
    // A is nine times B's size, so the world reads much more Western than the
    // one-nation-one-vote view does.
    const b = computeWorldBalance(
      [stand("A", 80, 20), stand("B", 20, 80)],
      new Map([
        ["A", 900],
        ["B", 100],
      ]),
      POLES
    )!;
    expect(b.byEconomy.shares.WEST).toBeCloseTo(74, 6); // (80*900 + 20*100)/1000
    expect(b.byNations.shares.WEST).toBeCloseTo(50, 6);
    expect(b.economyCount).toBe(2);
  });

  it("counts a nation with no GDP but does not weight it economically", () => {
    // Treating an unpriced nation as zero would quietly shrink whichever bloc
    // holds it, so it is excluded from the economic weighting entirely.
    const b = computeWorldBalance(
      [stand("A", 80, 20), stand("B", 20, 80)],
      new Map([["A", 900]]),
      POLES
    )!;
    expect(b.byEconomy.shares.WEST).toBeCloseTo(80, 6); // only A priced
    expect(b.economyCount).toBe(1);
    expect(b.nationCount).toBe(2);
  });

  it("returns null for an empty roster rather than a fabricated bar", () => {
    // 100% remainder would read as "the world is non-aligned" rather than
    // "no data", so the caller hides the bar instead.
    expect(computeWorldBalance([], new Map(), POLES)).toBeNull();
  });

  it("keeps each weighting summing to 100 with the remainder", () => {
    const b = computeWorldBalance([stand("A", 30, 40)], new Map([["A", 100]]), POLES)!;
    expect(total(b.byEconomy)).toBeCloseTo(100, 6);
    expect(total(b.byNations)).toBeCloseTo(100, 6);
  });

  it("falls back to a full remainder when nothing is priced", () => {
    // Every nation unpriced means the economic view has no basis at all — it
    // must not silently borrow the count-weighted answer.
    const b = computeWorldBalance([stand("A", 80, 20)], new Map(), POLES)!;
    expect(b.economyCount).toBe(0);
    expect(b.byEconomy.nonAligned).toBe(100);
    expect(b.byNations.shares.WEST).toBeCloseTo(80, 6);
  });
});
