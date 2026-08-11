/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import {
  computeFitProjection,
  regionLabelText,
  gradientEndpoints,
  featureCentroid,
  dropDegenerateRings,
  type GeoFeature,
} from "./RegionalGeoMap";

// react-simple-maps async-loads geojson, so the deterministic unit is the
// projection fit (pure d3-geo). Full render is a dev-server visual check.
const nirFeature = {
  type: "Feature" as const,
  properties: { regionCode: "NIR" },
  geometry: {
    type: "Polygon" as const,
    coordinates: [
      [
        [-8, 54],
        [-5, 54],
        [-5, 55],
        [-8, 55],
        [-8, 54],
      ],
    ],
  },
};

describe("computeFitProjection", () => {
  it("returns a finite center + positive scale fitting the given features", () => {
    const p = computeFitProjection({ type: "FeatureCollection", features: [nirFeature] }, 280, 400);
    expect(Number.isFinite(p.center[0])).toBe(true);
    expect(Number.isFinite(p.center[1])).toBe(true);
    expect(p.scale).toBeGreaterThan(0);
    // Center roughly over the feature (~ -6.5, 54.5).
    expect(p.center[0]).toBeGreaterThan(-9);
    expect(p.center[0]).toBeLessThan(-4);
  });

  it("returns a safe default for an empty set (no NaN)", () => {
    const p = computeFitProjection({ type: "FeatureCollection", features: [] }, 280, 400);
    expect(Number.isFinite(p.scale)).toBe(true);
    expect(p.scale).toBeGreaterThan(0);
  });
});

describe("regionLabelText", () => {
  it("prefers the override, falls back to the data label, then the bare code", () => {
    expect(regionLabelText("NORTE", { NORTE: "N" }, "Norte")).toBe("N");
    expect(regionLabelText("NORTE", undefined, "Norte")).toBe("Norte");
    expect(regionLabelText("NORTE", { SUL: "S" }, "Norte")).toBe("Norte"); // no entry for code
    expect(regionLabelText("NORTE", undefined, undefined)).toBe("NORTE");
  });
});

describe("gradientEndpoints", () => {
  it("returns a 45° diagonal (upper-left → lower-right) spanning the bbox center", () => {
    // bbox 0,0,10,10 → center (5,5), d=10 → (-5,15) to (15,-5)
    expect(gradientEndpoints({ x: 0, y: 0, width: 10, height: 10 })).toEqual({
      x1: -5,
      y1: 15,
      x2: 15,
      y2: -5,
    });
    // y1 > y2 (top-left starts lower on screen) and x1 < x2 — the 45° direction.
    const g = gradientEndpoints({ x: 2, y: 4, width: 20, height: 8 });
    expect(g.x1).toBeLessThan(g.x2);
    expect(g.y1).toBeGreaterThan(g.y2);
  });
});

describe("featureCentroid (ticket #0861 — labels landing in the ocean)", () => {
  it("returns the true center of a simple square Polygon", () => {
    const square: GeoFeature = {
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
            [0, 0],
          ],
        ],
      },
    };
    const [x, y] = featureCentroid(square);
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBeCloseTo(1, 6);
  });

  it("picks the biggest part's centroid for a MultiPolygon, not the midpoint between parts", () => {
    // Mirrors Michigan (two peninsulas) or Maryland/Virginia (mainland + a
    // small offshore/detached piece) — a big body plus a tiny, far-away part.
    // The old vertex-mean gave every ring's corners equal weight regardless
    // of area, so a 4-corner speck 10 units away pulled the "centroid" out
    // into the empty gap between the two parts.
    const multi: GeoFeature = {
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [0, 0],
              [2, 0],
              [2, 2],
              [0, 2],
              [0, 0],
            ],
          ],
          [
            [
              [10, 10],
              [10.1, 10],
              [10.1, 10.1],
              [10, 10.1],
              [10, 10],
            ],
          ],
        ],
      },
    };
    const [x, y] = featureCentroid(multi);
    // Correct: inside the big square (area 4 vs. ~0.01 for the speck).
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBeCloseTo(1, 6);
    // The old bug landed near (5, 5) — the vertex-count midpoint, in open
    // water between the two parts. Guard against regressing to that.
    expect(Math.hypot(x - 5, y - 5)).toBeGreaterThan(3);
  });

  it("computes the true area-weighted centroid for an L-shaped concave Polygon", () => {
    // Area-weighted centroid (unlike a naive vertex mean or bbox center) is the
    // standard, mathematically correct definition — it can still land in a
    // shape's concave notch for an extreme L, but it's always the right
    // answer for the shape's actual mass distribution, which is what matters
    // once combined with picking the biggest connected part (the test above)
    // for the real-world multi-part case this ticket is about.
    const lShape: GeoFeature = {
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [4, 0],
            [4, 1],
            [1, 1],
            [1, 4],
            [0, 4],
            [0, 0],
          ],
        ],
      },
    };
    const [x, y] = featureCentroid(lShape);
    // Two rects (area 4 @ (2, 0.5)) + (area 3 @ (0.5, 2.5)), combined over
    // total area 7: (9.5/7, 9.5/7).
    expect(x).toBeCloseTo(9.5 / 7, 6);
    expect(y).toBeCloseTo(9.5 / 7, 6);
  });

  it("falls back to the whole-geometry vertex mean when geometry.type is missing", () => {
    const untyped: GeoFeature = {
      geometry: {
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
          ],
        ],
      },
    };
    const [x, y] = featureCentroid(untyped);
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBeCloseTo(1, 6);
  });
});

describe("dropDegenerateRings", () => {
  const ring = (n: number) => Array.from({ length: n }, (_, i) => [i, i]);

  // A GeoJSON linear ring needs >= 4 positions. cn-regions.json ships a ONE-POINT
  // ring inside HN, which makes d3-geo throw and takes the whole map down.
  it("removes a sub-4-point ring from a MultiPolygon", () => {
    const f = {
      properties: { regionCode: "HN" },
      geometry: { type: "MultiPolygon", coordinates: [[ring(957)], [ring(1)], [ring(6)]] },
    } as never;
    const out = dropDegenerateRings(f)!;
    const polys = (out.geometry as { coordinates: unknown[][] }).coordinates;
    expect(polys).toHaveLength(2);
    expect(polys.flat().map((r) => (r as unknown[]).length)).toEqual([957, 6]);
  });

  it("leaves valid geometry untouched", () => {
    const coords = [[ring(10)], [ring(20)]];
    const f = {
      properties: { regionCode: "OK" },
      geometry: { type: "MultiPolygon", coordinates: coords },
    } as never;
    const out = dropDegenerateRings(f)!;
    expect((out.geometry as { coordinates: unknown }).coordinates).toEqual(coords);
  });

  it("trims a Polygon's bad rings", () => {
    const f = {
      properties: { regionCode: "P" },
      geometry: { type: "Polygon", coordinates: [ring(8), ring(2)] },
    } as never;
    const out = dropDegenerateRings(f)!;
    expect((out.geometry as { coordinates: unknown[] }).coordinates).toHaveLength(1);
  });

  it("drops a feature left with nothing drawable", () => {
    const f = {
      properties: { regionCode: "X" },
      geometry: { type: "Polygon", coordinates: [ring(2)] },
    } as never;
    expect(dropDegenerateRings(f)).toBeNull();
  });

  it("passes through a feature with no geometry", () => {
    const f = { properties: { regionCode: "N" } } as never;
    expect(dropDegenerateRings(f)).toBe(f);
  });
});
