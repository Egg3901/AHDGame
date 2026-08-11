import { describe, it, expect } from "vitest";
import { featureArea, featureCentre, orderFeatures, occupiedCodes } from "./frontGeometry";
import type { GeoFeature } from "@/components/maps/RegionalGeoMap";
import { anchorOf } from "./countryAnchors";

/** A square region with its lower-left corner at (x, y) — the shape shards carry. */
function square(regionCode: string, x: number, y: number, size = 1): GeoFeature {
  return {
    properties: { regionCode },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [x, y],
          [x + size, y],
          [x + size, y + size],
          [x, y + size],
          [x, y],
        ],
      ],
    },
  } as GeoFeature;
}

const codes = (fs: GeoFeature[]) => fs.map((f) => f.properties?.regionCode);

describe("featureArea", () => {
  it("measures a unit square as 1", () => {
    expect(featureArea(square("AA", 0, 0))).toBeCloseTo(1);
  });

  it("measures a 2×2 square as 4", () => {
    expect(featureArea(square("AA", 0, 0, 2))).toBeCloseTo(4);
  });

  it("is independent of ring winding direction", () => {
    const cw = square("AA", 0, 0);
    const ring = (cw.geometry!.coordinates as number[][][])[0];
    const flipped = {
      ...cw,
      geometry: { type: "Polygon", coordinates: [[...ring].reverse()] },
    } as GeoFeature;
    expect(featureArea(flipped)).toBeCloseTo(1);
  });

  it("sums the parts of a MultiPolygon", () => {
    const multi = {
      properties: { regionCode: "MM" },
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          ],
          [
            [
              [5, 5],
              [7, 5],
              [7, 7],
              [5, 7],
              [5, 5],
            ],
          ],
        ],
      },
    } as GeoFeature;
    expect(featureArea(multi)).toBeCloseTo(5); // 1 + 4
  });

  it("is zero for a feature with no geometry", () => {
    expect(featureArea({ properties: { regionCode: "X" } } as GeoFeature)).toBe(0);
  });
});

describe("featureCentre", () => {
  it("returns the bounding-box centre", () => {
    expect(featureCentre(square("AA", 0, 0, 2))).toEqual([1, 1]);
  });

  it("falls back to the origin for a feature with no geometry", () => {
    expect(featureCentre({ properties: { regionCode: "X" } } as GeoFeature)).toEqual([0, 0]);
  });
});

describe("orderFeatures", () => {
  const near = square("NEAR", 0, 0);
  const far = square("FAR", 10, 0);

  it("orders nearest-to-anchor first when an anchor is given", () => {
    expect(codes(orderFeatures([far, near], [-5, 0]))).toEqual(["NEAR", "FAR"]);
  });

  it("orders periphery-inward when no anchor is given", () => {
    // Three in a row: the middle is closest to the host's own centre, so it falls last.
    const mid = square("MID", 5, 0);
    const out = orderFeatures([mid, near, far], null);
    expect(out[out.length - 1].properties?.regionCode).toBe("MID");
  });

  it("is deterministic for equidistant regions", () => {
    expect(codes(orderFeatures([square("BBB", 0, 0), square("AAA", 0, 0)], [0, 0]))).toEqual([
      "AAA",
      "BBB",
    ]);
  });

  it("does not mutate its input", () => {
    const input = [far, near];
    orderFeatures(input, [-5, 0]);
    expect(codes(input)).toEqual(["FAR", "NEAR"]);
  });

  it("returns an empty list unchanged", () => {
    expect(orderFeatures([], [0, 0])).toEqual([]);
  });
});

describe("occupiedCodes", () => {
  const ordered = [square("A", 0, 0), square("B", 1, 0), square("C", 2, 0), square("D", 3, 0)];

  it("takes nothing at 0%", () => {
    expect(occupiedCodes(ordered, 0).size).toBe(0);
  });

  it("takes everything at 100%", () => {
    expect(occupiedCodes(ordered, 100).size).toBe(4);
  });

  it("takes the leading half at 50%", () => {
    expect(occupiedCodes(ordered, 50)).toEqual(new Set(["A", "B"]));
  });

  it("takes the first region for any non-zero share", () => {
    expect(occupiedCodes(ordered, 1)).toEqual(new Set(["A"]));
  });

  it("weights by area, not by count", () => {
    // One vast region and two small: 50% is covered by the vast one alone.
    const weighted = [square("BIG", 0, 0, 3), square("a", 10, 0), square("b", 11, 0)];
    expect(occupiedCodes(weighted, 50)).toEqual(new Set(["BIG"]));
  });

  it("returns nothing for an empty list", () => {
    expect(occupiedCodes([], 50).size).toBe(0);
  });

  it("clamps a share above 100%", () => {
    expect(occupiedCodes(ordered, 150).size).toBe(4);
  });
});

describe("anchorOf", () => {
  it("knows the four playable nations", () => {
    for (const id of ["US", "UK", "RU", "DD"]) expect(anchorOf(id)).not.toBeNull();
  });

  it("returns null for a country with no anchor", () => {
    expect(anchorOf("ZZ")).toBeNull();
  });
});
