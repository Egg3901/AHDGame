import { describe, expect, it } from "vitest";
import {
  ERA_ANCHOR_YEARS,
  ERA_IDS_ASC,
  eraIdForYear,
  interpolateEraBundles,
  lerpNumericTree,
  renormalizeShares,
  resolveEraBlend,
} from "./eraInterpolation";
import { ERA_COMPOSITIONS } from "./demographicCategories";
import type { EraId } from "./presetSelector";

describe("resolveEraBlend", () => {
  it("returns t=0 at every anchor year", () => {
    for (const era of ERA_IDS_ASC) {
      const b = resolveEraBlend(ERA_ANCHOR_YEARS[era]);
      expect(b.lo).toBe(era);
      expect(b.hi).toBe(era);
      expect(b.t).toBe(0);
    }
  });

  it("clamps outside the anchor range", () => {
    expect(resolveEraBlend(1900)).toMatchObject({ lo: "1953", hi: "1953", t: 0 });
    expect(resolveEraBlend(2100)).toMatchObject({ lo: "2023", hi: "2023", t: 0 });
  });

  it("brackets between adjacent anchors with linear t", () => {
    // 1966 is exactly halfway through 1953..1979
    const b = resolveEraBlend(1966);
    expect(b.lo).toBe("1953");
    expect(b.hi).toBe("1979");
    expect(b.t).toBeCloseTo(0.5, 10);
  });

  it("respects a sparse available set", () => {
    const b = resolveEraBlend(1991, ["1953", "1979", "2019"]);
    expect(b.lo).toBe("1979");
    expect(b.hi).toBe("2019");
    expect(b.t).toBeCloseTo((1991 - 1979) / (2019 - 1979), 10);
  });
});

describe("eraIdForYear", () => {
  it("is the at-or-below anchor, clamped", () => {
    expect(eraIdForYear(1953)).toBe("1953");
    expect(eraIdForYear(1978)).toBe("1953");
    expect(eraIdForYear(1979)).toBe("1979");
    expect(eraIdForYear(2005)).toBe("1999");
    expect(eraIdForYear(1900)).toBe("1953");
    expect(eraIdForYear(2100)).toBe("2023");
  });
});

describe("lerpNumericTree", () => {
  it("lerps numbers and nested structures", () => {
    const lo = { a: 0, b: { c: [1, 2], d: "same" } };
    const hi = { a: 10, b: { c: [3, 4], d: "same" } };
    expect(lerpNumericTree(lo, hi, 0.5)).toEqual({ a: 5, b: { c: [2, 3], d: "same" } });
  });

  it("returns fresh containers even at t=0", () => {
    const lo = { a: { b: 1 } };
    const out = lerpNumericTree(lo, lo, 0);
    expect(out).toEqual(lo);
    expect(out).not.toBe(lo);
    expect(out.a).not.toBe(lo.a);
  });

  it("throws with a path on key-set mismatch", () => {
    expect(() => lerpNumericTree({ x: { a: 1 } }, { x: { b: 1 } } as never, 0.5)).toThrow(
      /\$\.x: -a, \+b/
    );
  });

  it("throws on differing string leaves and array shape", () => {
    expect(() => lerpNumericTree({ s: "a" }, { s: "b" }, 0.5)).toThrow(/non-numeric/);
    expect(() => lerpNumericTree({ a: [1] }, { a: [1, 2] }, 0.5)).toThrow(/array shape/);
  });
});

describe("interpolateEraBundles", () => {
  it("anchor identity: at an anchor year the result is value-identical and not the same reference", () => {
    for (const era of ERA_IDS_ASC) {
      const out = interpolateEraBundles(ERA_COMPOSITIONS, ERA_ANCHOR_YEARS[era], "test:comps");
      expect(out).toEqual(ERA_COMPOSITIONS[era]);
      expect(out).not.toBe(ERA_COMPOSITIONS[era]);
    }
  });

  it("skips missing eras and blends between the nearest authored anchors", () => {
    const sparse: Partial<Record<EraId, { v: number }>> = {
      "1953": { v: 0 },
      "2019": { v: 66 },
    };
    expect(interpolateEraBundles(sparse, 1986).v).toBeCloseTo(33, 10);
    // clamp on the sparse range too
    expect(interpolateEraBundles(sparse, 2023).v).toBe(66);
  });

  it("labels structural failures with the blend and year", () => {
    const bad: Partial<Record<EraId, unknown>> = {
      "1953": { a: 1 },
      "1979": { b: 1 },
    };
    expect(() => interpolateEraBundles(bad, 1966, "test:bad")).toThrow(
      /test:bad: 1953↔1979 @ 1966/
    );
  });
});

describe("renormalizeShares", () => {
  it("scales a rounded vector back to the target total", () => {
    const out = renormalizeShares({ a: 0.5, b: 0.49 });
    expect(out.a + out.b).toBeCloseTo(1, 12);
    expect(out.a / out.b).toBeCloseTo(0.5 / 0.49, 12);
  });

  it("passes zero vectors through and rejects negatives", () => {
    expect(renormalizeShares({ a: 0, b: 0 })).toEqual({ a: 0, b: 0 });
    expect(() => renormalizeShares({ a: -1, b: 2 })).toThrow(/invalid share/);
  });
});
