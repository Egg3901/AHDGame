import { describe, it, expect } from "vitest";
import { projectRegions } from "./projectRegions";
import type { GeoFeature } from "@/components/maps/RegionalGeoMap";

const BOX = { w: 620, h: 837 };

function square(
  code: string,
  name: string | undefined,
  lon: number,
  lat: number,
  size = 2
): GeoFeature {
  return {
    properties: name ? { regionCode: code, na: name } : { regionCode: code },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [lon, lat],
          [lon + size, lat],
          [lon + size, lat + size],
          [lon, lat + size],
          [lon, lat],
        ],
      ],
    },
  };
}

describe("projectRegions", () => {
  it("returns null for no drawable geometry", () => {
    expect(projectRegions([], BOX)).toBeNull();
    expect(projectRegions([{ properties: { regionCode: "X" }, geometry: null }], BOX)).toBeNull();
  });

  it("projects features into the box, inset by the pad", () => {
    const g = projectRegions([square("A", "Alpha", 6, 48), square("B", "Beta", 10, 52)], BOX)!;
    for (const ring of g.rings) {
      for (const [x, y] of ring) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(BOX.w);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(BOX.h);
      }
    }
  });

  it("keeps north up — a higher latitude projects to a smaller y", () => {
    const g = projectRegions([square("S", "South", 6, 44), square("N", "North", 6, 54)], BOX)!;
    const south = g.regions.find((r) => r.id === "S")!;
    const north = g.regions.find((r) => r.id === "N")!;
    expect(north.cy).toBeLessThan(south.cy);
  });

  it("falls back to the region code when the shard carries no name", () => {
    const g = projectRegions([square("BEO", undefined, 13, 52)], BOX)!;
    expect(g.regions[0].name).toBe("BEO");
  });

  it("emits closed paths with no NaN", () => {
    const g = projectRegions([square("A", "Alpha", 6, 48)], BOX)!;
    expect(g.regions[0].d).toMatch(/^M[\d. L]+Z$/);
    expect(g.regions[0].d).not.toMatch(/NaN/);
  });

  it("weights area by size and subtracts holes", () => {
    const solid = projectRegions([square("A", "A", 6, 48, 4)], BOX)!;
    const holed = projectRegions(
      [
        {
          properties: { regionCode: "A", na: "A" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [6, 48],
                [10, 48],
                [10, 52],
                [6, 52],
                [6, 48],
              ],
              [
                [7, 49],
                [9, 49],
                [9, 51],
                [7, 51],
                [7, 49],
              ],
            ],
          },
        },
      ],
      BOX
    )!;
    expect(holed.regions[0].area).toBeLessThan(solid.regions[0].area);
    // Both rings are sampled, so the hole can subtract in `sampleLand` too.
    expect(holed.rings.length).toBe(2);
  });

  it("drops rings too short to close", () => {
    const g = projectRegions(
      [
        {
          properties: { regionCode: "A", na: "A" },
          geometry: { type: "Polygon", coordinates: [[[6, 48]]] },
        },
        square("B", "Beta", 10, 52),
      ],
      BOX
    )!;
    expect(g.regions.map((r) => r.id)).toEqual(["B"]);
  });

  it("projects an off-map anchor outside the box, keeping its bearing", () => {
    const g = projectRegions([square("A", "Alpha", 6, 48), square("B", "Beta", 10, 52)], BOX)!;
    const [x] = g.project([-98.5, 39.8]); // the US anchor, far west of Germany
    expect(x).toBeLessThan(0);
  });

  it("handles a MultiPolygon's parts as separate rings", () => {
    const g = projectRegions(
      [
        {
          properties: { regionCode: "M", na: "Multi" },
          geometry: {
            type: "MultiPolygon",
            coordinates: [
              [
                [
                  [6, 48],
                  [7, 48],
                  [7, 49],
                  [6, 49],
                  [6, 48],
                ],
              ],
              [
                [
                  [10, 52],
                  [12, 52],
                  [12, 54],
                  [10, 54],
                  [10, 52],
                ],
              ],
            ],
          },
        },
      ],
      BOX
    )!;
    expect(g.rings.length).toBe(2);
    // The label anchors on the LARGER part, not in the water between them.
    expect(g.regions[0].cx).toBeGreaterThan(BOX.w / 2);
  });
});
