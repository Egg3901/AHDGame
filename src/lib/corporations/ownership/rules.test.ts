import { describe, expect, it } from "vitest";
import { ownershipChanges, ownershipKey, ownershipSeries, type OwnershipSnapshot } from "./rules";

const snapshot = (turn: number, totalShares: number, shares: number): OwnershipSnapshot => ({
  turn,
  totalShares,
  holders: [{ key: "character:one", shares }],
  publicFloat: totalShares - shares,
});

describe("ownership tracking", () => {
  it("uses each turn's denominator across dilution and splits", () => {
    const rows = [snapshot(1, 100, 40), snapshot(2, 200, 40), snapshot(3, 2000, 400)];
    expect(ownershipSeries(rows, "character:one").map((p) => p.percent)).toEqual([40, 20, 20]);
    expect(ownershipChanges(rows)?.changes[0].change).toBe(-20);
    expect(ownershipChanges(rows.slice(1))?.changes[0].change).toBe(0);
  });

  it("distinguishes absent snapshots, missing registers and a known exit", () => {
    const rows = [
      snapshot(1, 100, 40),
      { ...snapshot(3, 100, 0), holders: null },
      { ...snapshot(4, 100, 0), holders: [] },
    ];
    expect(ownershipSeries(rows, "character:one").map((p) => p.percent)).toEqual([
      40,
      null,
      null,
      0,
    ]);
    expect(ownershipChanges(rows)?.changes[0]).toMatchObject({ before: 40, after: 0, change: -40 });
    expect(ownershipChanges([rows[1]])).toBeNull();
  });

  it("keeps missing float unknown and combines repeated holder entries", () => {
    const row = {
      ...snapshot(5, 100, 20),
      publicFloat: null,
      holders: [
        { key: "one", shares: 20 },
        { key: "one", shares: 10 },
      ],
    };
    expect(ownershipSeries([row], "public_float")[0].percent).toBeNull();
    expect(ownershipSeries([row], "one")[0].percent).toBe(30);
  });

  it("tracks new and departed holders and keeps holder classes separate", () => {
    const rows = [
      snapshot(1, 100, 40),
      { ...snapshot(2, 100, 0), holders: [{ key: "fund:two", shares: 40 }] },
    ];
    expect(ownershipChanges(rows)?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "character:one", after: 0 }),
        expect.objectContaining({ key: "fund:two", before: 0, change: 40 }),
      ])
    );
    expect(ownershipKey("character", "same")).not.toBe(ownershipKey("imperial", "same"));
    expect(ownershipSeries([], "one")).toEqual([]);
    expect(ownershipSeries([snapshot(1, 0, 0)], "character:one")[0].percent).toBeNull();
    expect(ownershipChanges([snapshot(1, 100, 0), snapshot(2, 100, 0)])?.changes).toEqual([]);
  });
});
