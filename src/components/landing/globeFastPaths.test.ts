import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { geoGraticule10, geoOrthographic, geoPath, geoRotation } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import { createGlobeFrame } from "./globeFastPaths";

const topology = JSON.parse(
  readFileSync(path.join(process.cwd(), "public/geo/countries-110m.json"), "utf8")
) as Topology;
const countries = (
  feature(topology, topology.objects.countries as GeometryCollection) as FeatureCollection
).features as Feature[];

const SCALE = 160;
const TRANSLATE: [number, number] = [320, 184];

function frameAt(rotation: [number, number, number]) {
  const pathGen = geoPath(
    geoOrthographic()
      .scale(SCALE)
      .translate(TRANSLATE)
      .rotate(rotation)
      .clipAngle(90 + 1e-6)
  );
  return {
    pathGen,
    frame: createGlobeFrame(geoRotation(rotation), SCALE, TRANSLATE, (o) => pathGen(o as never)),
  };
}

/** [minX, minY, maxX, maxY] of every coordinate in a `d`. */
function bounds(d: string): number[] {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const xs = n.filter((_, i) => i % 2 === 0);
  const ys = n.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const VIEWS: [number, number, number][] = [
  [-24, -42, 0],
  [100, -20, 0],
  [-170, 10, 0],
  [60, 55, 0],
  [-80, -65, 0],
];

describe("createGlobeFrame", () => {
  it("shows and hides exactly the countries d3 does", () => {
    for (const view of VIEWS) {
      const { pathGen, frame } = frameAt(view);
      for (const country of countries) {
        expect(frame.feature(country) === null, `${country.id} at ${view}`).toBe(
          pathGen(country) === null
        );
      }
    }
  });

  it("draws a country in front of the horizon where d3 does, to a fraction of a unit", () => {
    for (const view of VIEWS) {
      const { pathGen, frame } = frameAt(view);
      for (const country of countries) {
        const ours = frame.feature(country);
        const theirs = pathGen(country);
        if (!ours || !theirs) continue;
        const a = bounds(ours);
        const b = bounds(theirs);
        for (let i = 0; i < 4; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(0.3);
      }
    }
  });

  it("cuts lines at the horizon", () => {
    const graticule = geoGraticule10();
    for (const view of VIEWS) {
      const { pathGen, frame } = frameAt(view);
      const a = bounds(frame.lines(graticule));
      const b = bounds(pathGen(graticule)!);
      for (let i = 0; i < 4; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(0.3);
    }
  });

  it("draws nothing for a line wholly behind the globe", () => {
    const { frame } = frameAt([0, 0, 0]);
    expect(
      frame.lines({
        type: "LineString",
        coordinates: [
          [170, 0],
          [175, 10],
        ],
      })
    ).toBe("");
  });
});
