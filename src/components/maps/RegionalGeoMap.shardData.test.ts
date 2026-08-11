import { describe, it, expect } from "vitest";
import { dropDegenerateRings, type GeoFeature } from "./RegionalGeoMap";
import fc from "../../../public/cn-regions.json";

// Regression: the real HN feature in cn-regions.json crashes d3-geo. Every consumer
// of this shard — the conflict front map AND /country/cn/map — renders it.
// d3-geo ships no bundled types here, so the repo imports it dynamically
// (see WorldMapSVG / OrgWorldMap). Same convention.
const { geoPath, geoEqualEarth } = await import("d3-geo");

describe("cn-regions.json HN part", () => {
  const feats = (fc as { features: unknown[] }).features as GeoFeature[];
  const hn = feats.find((f) => f.properties?.regionCode === "HN")!;
  const path = geoPath(geoEqualEarth());

  it("throws in d3-geo untouched", () => {
    expect(() => path(hn as never)).toThrow(/Cannot read properties of undefined/);
  });

  it("renders once degenerate rings are dropped", () => {
    const cleaned = dropDegenerateRings(hn)!;
    expect(cleaned).not.toBeNull();
    const d = path(cleaned as never);
    expect(typeof d).toBe("string");
    expect(d!.length).toBeGreaterThan(1000);
  });

  it("leaves every other CN region renderable", () => {
    for (const f of feats) {
      const cleaned = dropDegenerateRings(f);
      expect(cleaned).not.toBeNull();
      expect(() => path(cleaned as never)).not.toThrow();
    }
  });
});
