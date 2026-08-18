import { describe, it, expect } from "vitest";
import {
  sampleLand,
  frontLine,
  axisWords,
  fallbackAdvanceAnchor,
  type PxRing,
  type PxPoint,
} from "./frontLine";

const BOX = { w: 200, h: 200 };

/** A 100×100 square from (50,50) to (150,150) — half the box's width and height. */
const SQUARE: PxRing = [
  [50, 50],
  [150, 50],
  [150, 150],
  [50, 150],
];

/** A 40×40 hole in the middle of SQUARE. */
const HOLE: PxRing = [
  [80, 80],
  [120, 80],
  [120, 120],
  [80, 120],
];

describe("sampleLand", () => {
  it("samples only cells inside the ring", () => {
    const land = sampleLand([SQUARE], BOX, 10);
    expect(land.length).toBe(100); // 10×10 cells of a 100×100 square at step 10
    for (const [x, y] of land) {
      expect(x).toBeGreaterThan(50);
      expect(x).toBeLessThan(150);
      expect(y).toBeGreaterThan(50);
      expect(y).toBeLessThan(150);
    }
  });

  it("subtracts a hole (even-odd), so an enclave is not counted as land", () => {
    const withHole = sampleLand([SQUARE, HOLE], BOX, 10);
    expect(withHole.length).toBe(100 - 16); // 4×4 cells removed
    expect(withHole.some(([x, y]) => x === 105 && y === 105)).toBe(false);
  });

  it("returns nothing for an empty ring set", () => {
    expect(sampleLand([], BOX, 10)).toEqual([]);
  });

  it("is deterministic", () => {
    expect(sampleLand([SQUARE], BOX, 10)).toEqual(sampleLand([SQUARE], BOX, 10));
  });
});

describe("frontLine", () => {
  const land = sampleLand([SQUARE], BOX, 10);
  /** Due west of the box, so the advance runs west → east and `u` is +x. */
  const westAnchor: PxPoint = [-500, 100];

  it("returns null with no land to place a line on", () => {
    expect(frontLine(BOX, [], westAnchor, 50)).toBeNull();
  });

  it("returns null when the anchor sits on the host's own centre", () => {
    expect(frontLine(BOX, land, [100, 100], 50)).toBeNull();
  });

  it("orients the advance from the anchor toward the host centre", () => {
    const f = frontLine(BOX, land, westAnchor, 50)!;
    expect(f.u[0]).toBeCloseTo(1, 6);
    expect(f.u[1]).toBeCloseTo(0, 6);
  });

  it("holds nothing at 0% and everything at 100%", () => {
    const none = frontLine(BOX, land, westAnchor, 0)!;
    const all = frontLine(BOX, land, westAnchor, 100)!;
    expect(land.filter((p) => none.held(p)).length).toBe(0);
    expect(land.filter((p) => all.held(p)).length).toBe(land.length);
  });

  it("puts roughly `pct` of the sampled land behind the line", () => {
    for (const pct of [25, 50, 75]) {
      const f = frontLine(BOX, land, westAnchor, pct)!;
      const held = (land.filter((p) => f.held(p)).length / land.length) * 100;
      // The jitter waves the line ±~17px around its nominal position, so the
      // share is close rather than exact — the picture, not the arithmetic, is
      // what the jitter serves.
      expect(Math.abs(held - pct)).toBeLessThan(15);
    }
  });

  it("advances monotonically as control rises", () => {
    const shares = [0, 20, 40, 60, 80, 100].map((pct) => {
      const f = frontLine(BOX, land, westAnchor, pct)!;
      return land.filter((p) => f.held(p)).length;
    });
    for (let i = 1; i < shares.length; i++) {
      expect(shares[i]).toBeGreaterThanOrEqual(shares[i - 1]);
    }
  });

  it("emits finite SVG paths, with `taken` closed", () => {
    const f = frontLine(BOX, land, westAnchor, 60)!;
    expect(f.line.startsWith("M")).toBe(true);
    expect(f.line).not.toMatch(/NaN/);
    expect(f.taken).not.toMatch(/NaN/);
    expect(f.taken.endsWith("Z")).toBe(true);
  });

  it("crosses the whole box, so no corner is left unpainted", () => {
    const f = frontLine(BOX, land, westAnchor, 50)!;
    const ys = f.line
      .slice(1)
      .split("L")
      .map((p) => Number(p.split(" ")[1]));
    expect(Math.min(...ys)).toBeLessThan(0);
    expect(Math.max(...ys)).toBeGreaterThan(BOX.h);
  });

  it("is stable across calls, so server and client render the same line", () => {
    expect(frontLine(BOX, land, westAnchor, 63)!.line).toEqual(
      frontLine(BOX, land, westAnchor, 63)!.line
    );
  });

  it("reverses with the anchor: an eastern advance holds the opposite ground", () => {
    const west = frontLine(BOX, land, westAnchor, 30)!;
    const east = frontLine(BOX, land, [700, 100], 30)!;
    const heldByWest = land.filter((p) => west.held(p));
    const heldByEast = land.filter((p) => east.held(p));
    expect(heldByWest.every(([x]) => x < 100)).toBe(true);
    expect(heldByEast.every(([x]) => x > 100)).toBe(true);
  });
});

describe("axisWords / fallbackAdvanceAnchor", () => {
  it("names only the dominant compass pair", () => {
    expect(axisWords([1, 0])).toBe("west → east");
    expect(axisWords([-1, 0])).toBe("east → west");
    expect(axisWords([0, 1])).toBe("north → south");
    expect(axisWords([0, -1])).toBe("south → north");
  });

  it("puts a portrait host on a north-south axis", () => {
    const box = { w: 620, h: 837 };
    const anchor = fallbackAdvanceAnchor(box);
    expect(anchor[1]).toBeLessThan(box.h / 2);
    expect(anchor[0]).toBe(box.w / 2);
    const land = sampleLand(
      [
        [
          [50, 50],
          [570, 50],
          [570, 787],
          [50, 787],
        ],
      ],
      box
    );
    const front = frontLine(box, land, anchor, 50)!;
    expect(Math.abs(front.u[1])).toBeGreaterThan(Math.abs(front.u[0]));
    expect(axisWords(front.u)).toBe("north → south");
  });

  it("keeps a landscape host on a west-east axis", () => {
    const box = { w: 900, h: 638 };
    const anchor = fallbackAdvanceAnchor(box);
    expect(anchor[0]).toBeLessThan(box.w / 2);
    expect(axisWords([1, 0])).toBe("west → east");
  });
});
