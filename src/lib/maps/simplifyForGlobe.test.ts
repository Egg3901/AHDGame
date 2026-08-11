import { describe, it, expect } from "vitest";
import { simplifyForGlobe, simplifyGlobeRing } from "./simplifyForGlobe";

/** Dense unit square: many colinear samples along each edge. */
function denseSquare(n = 40): number[][] {
  const ring: number[][] = [];
  for (let i = 0; i <= n; i++) ring.push([i / n, 0]);
  for (let i = 1; i <= n; i++) ring.push([1, i / n]);
  for (let i = 1; i <= n; i++) ring.push([1 - i / n, 1]);
  for (let i = 1; i <= n; i++) ring.push([0, 1 - i / n]);
  return ring;
}

describe("simplifyGlobeRing", () => {
  it("drops rings below the area floor", () => {
    const speck = [
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
      [0, 0.01],
      [0, 0],
    ];
    expect(simplifyGlobeRing(speck, 0.05, 0.5)).toBeNull();
  });

  it("reduces a dense coastline while keeping a closed ring", () => {
    const dense = denseSquare(50);
    const simplified = simplifyGlobeRing(dense, 0.05, 0.5);
    expect(simplified).not.toBeNull();
    expect(simplified!.length).toBeLessThan(dense.length);
    expect(simplified!.length).toBeGreaterThanOrEqual(4);
    const a = simplified![0]!;
    const b = simplified![simplified!.length - 1]!;
    expect(a[0]).toBe(b[0]);
    expect(a[1]).toBe(b[1]);
  });
});

describe("simplifyForGlobe", () => {
  it("keeps a large landmass and drops a speck island", () => {
    const land = denseSquare(30); // area 1
    const speck = [
      [10, 10],
      [10.01, 10],
      [10.01, 10.01],
      [10, 10.01],
      [10, 10],
    ];
    const out = simplifyForGlobe([[land], [speck]]);
    expect(out).toHaveLength(1);
    expect(out[0]![0]!.length).toBeLessThan(land.length);
  });
});
