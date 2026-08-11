import { describe, expect, it } from "vitest";
import {
  computeInKindEquityDistribution,
  type InKindShareholder,
} from "./inKindEquityDistribution";

const sum = (rows: { shares: number }[]) => rows.reduce((s, r) => s + r.shares, 0);

describe("computeInKindEquityDistribution", () => {
  it("splits a held block pro-rata to shareholders + public float", () => {
    const shareholders: InKindShareholder[] = [{ id: "z", kind: "character", shares: 8 }];
    const r = computeInKindEquityDistribution({
      shareholders,
      publicFloatShares: 2,
      totalShares: 10,
      blockShares: 100,
    });
    expect(r.allocations).toEqual([{ id: "z", kind: "character", shares: 80 }]);
    expect(r.publicFloatShares).toBe(20);
  });

  it("conserves exactly via largest-remainder when shares don't divide evenly", () => {
    const shareholders: InKindShareholder[] = [
      { id: "a", kind: "character", shares: 1 },
      { id: "b", kind: "corporation", shares: 1 },
      { id: "c", kind: "imperial", shares: 1 },
    ];
    const r = computeInKindEquityDistribution({
      shareholders,
      publicFloatShares: 0,
      totalShares: 3,
      blockShares: 10,
    });
    // 10/3 = 3.33 each → floors 3,3,3 = 9, leftover 1 to the top remainder.
    expect(sum(r.allocations) + r.publicFloatShares).toBe(10);
    expect(r.allocations.map((a) => a.shares).sort()).toEqual([3, 3, 4]);
    expect(r.publicFloatShares).toBe(0);
  });

  it("includes index fund shareholders in the pro-rata split", () => {
    const shareholders: InKindShareholder[] = [
      { id: "char", kind: "character", shares: 5 },
      { id: "fund", kind: "fund", shares: 5 },
    ];
    const r = computeInKindEquityDistribution({
      shareholders,
      publicFloatShares: 0,
      totalShares: 10,
      blockShares: 100,
    });
    expect(r.allocations).toContainEqual({ id: "fund", kind: "fund", shares: 50 });
    expect(r.allocations).toContainEqual({ id: "char", kind: "character", shares: 50 });
    expect(sum(r.allocations) + r.publicFloatShares).toBe(100);
  });

  it("routes the whole block to float when there are no shareholders", () => {
    const r = computeInKindEquityDistribution({
      shareholders: [],
      publicFloatShares: 10,
      totalShares: 10,
      blockShares: 50,
    });
    expect(r.allocations).toEqual([]);
    expect(r.publicFloatShares).toBe(50);
  });

  it("returns nothing for a zero block", () => {
    const r = computeInKindEquityDistribution({
      shareholders: [{ id: "z", kind: "character", shares: 10 }],
      publicFloatShares: 0,
      totalShares: 10,
      blockShares: 0,
    });
    expect(r.allocations).toEqual([]);
    expect(r.publicFloatShares).toBe(0);
  });

  it("preserves holder kind and never mints or burns shares (fuzz)", () => {
    for (let t = 0; t < 200; t++) {
      // Deterministic pseudo-inputs (no Math.random — vary by index).
      const n = (t % 4) + 1;
      const shareholders: InKindShareholder[] = Array.from({ length: n }, (_, i) => ({
        id: `s${i}`,
        kind: (["character", "imperial", "corporation"] as const)[(t + i) % 3],
        shares: ((t * 7 + i * 13) % 50) + 1,
      }));
      const publicFloatShares = (t * 3) % 40;
      const totalShares = sum(shareholders) + publicFloatShares;
      const blockShares = (t * 11) % 1000;
      const r = computeInKindEquityDistribution({
        shareholders,
        publicFloatShares,
        totalShares,
        blockShares,
      });
      expect(sum(r.allocations) + r.publicFloatShares).toBe(blockShares);
      for (const a of r.allocations) expect(a.shares).toBeGreaterThan(0);
    }
  });
});
