import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { JP_REGION_CODES, isJapanRegion } from "./japanGeometry";

describe("japanGeometry", () => {
  it("lists the eight Japanese macro-region codes", () => {
    expect(JP_REGION_CODES).toHaveLength(8);
    expect(new Set(JP_REGION_CODES).size).toBe(8);
    expect(isJapanRegion("KAN")).toBe(true);
    expect(isJapanRegion("NIR")).toBe(false);
  });

  it("the built shard dissolves to exactly the eight region codes, each with geometry", () => {
    const geo = JSON.parse(readFileSync("public/japan-regions.json", "utf8"));
    expect(geo.features).toHaveLength(8);
    const codes = geo.features.map(
      (f: { properties: { regionCode: string } }) => f.properties.regionCode
    );
    // The build script's grouping must agree with JP_REGION_CODES (drift guard).
    expect(new Set(codes)).toEqual(new Set(JP_REGION_CODES));
    for (const f of geo.features) {
      expect(JP_REGION_CODES).toContain(f.properties.regionCode);
      expect(f.geometry?.coordinates?.length).toBeGreaterThan(0);
    }
  });
});
