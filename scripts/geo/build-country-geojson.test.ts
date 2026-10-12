import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import type { FeatureCollection } from "geojson";
import { buildSuccessorMap } from "./build-country-geojson";
import {
  SUCCESSOR_REGION_COUNCILS,
  successorCouncilSeats,
} from "../../src/lib/countries/ukSuccessorRegions";
import { SUB_REGION_SEEDS } from "../../src/lib/referendum/secede/subRegions";

for (const country of ["SCO", "WAL"] as const) {
  describe(`${country} whole council geography`, () => {
    const groups = SUCCESSOR_REGION_COUNCILS[country];
    const codes = Object.values(groups)
      .flat()
      .map((c) => c.code);
    const source: FeatureCollection = {
      type: "FeatureCollection",
      features: codes.map((code, i) => ({
        type: "Feature",
        properties: { LAD24CD: code },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [i, 0],
              [i + 1, 0],
              [i + 1, 1],
              [i, 1],
              [i, 0],
            ],
          ],
        },
      })),
    };
    it("covers every council once and agrees with seeded regions and deployed map", () => {
      expect(new Set(codes).size).toBe(country === "SCO" ? 32 : 22);
      const raw = readFileSync(`public/${country.toLowerCase()}-regions.json`, "utf8");
      // Overview maps must not accidentally ship multi-megabyte detailed coastlines.
      expect(Buffer.byteLength(raw)).toBeLessThan(512 * 1024);
      const map = JSON.parse(raw) as FeatureCollection;
      expect(map.features.map((f) => String(f.id)).sort()).toEqual(
        SUB_REGION_SEEDS[country].map((s) => s._id).sort()
      );
      expect(map.features.flatMap((f) => f.properties!.councilCodes).sort()).toEqual(
        [...codes].sort()
      );
      for (const feature of map.features) {
        expect(feature.properties!.attribution).toContain("Office for National Statistics");
        expect(feature.properties!.attribution).toContain("Crown copyright");
        expect(feature.properties!.councilCodes.length).toBe(
          successorCouncilSeats(country)[String(feature.id)]
        );
      }
    });
    it("dissolves complete adjacent councils without slicing their area", () => {
      const map = buildSuccessorMap(country, source);
      for (const feature of map.features) {
        const geometry = feature.geometry;
        if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")
          throw new Error("Unexpected geometry");
        const polygons =
          geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
        const area = polygons.reduce(
          (sum, polygon) =>
            sum +
            polygon.reduce((a, ring, index) => {
              const signed =
                Math.abs(
                  ring
                    .slice(1)
                    .reduce(
                      (value, point, j) => value + ring[j][0] * point[1] - point[0] * ring[j][1],
                      0
                    )
                ) / 2;
              return a + (index === 0 ? signed : -signed);
            }, 0),
          0
        );
        expect(area).toBeCloseTo(feature.properties!.councilCodes.length, 2);
      }
    });
    it("rejects incomplete and duplicate source boundaries", () => {
      expect(() =>
        buildSuccessorMap(country, { ...source, features: source.features.slice(1) })
      ).toThrow(/missing/);
      expect(() =>
        buildSuccessorMap(country, {
          ...source,
          features: [...source.features, source.features[0]],
        })
      ).toThrow(/duplicate/);
    });
  });
}
