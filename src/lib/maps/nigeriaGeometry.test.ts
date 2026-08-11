import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NIGERIA_GEO_URL, NG_REGION_CODES, isNigeriaRegion } from "./nigeriaGeometry";

describe("nigeriaGeometry", () => {
  it("declares the six geopolitical zones", () => {
    expect([...NG_REGION_CODES].sort()).toEqual([
      "NORTH_CENTRAL",
      "NORTH_EAST",
      "NORTH_WEST",
      "SOUTH_EAST",
      "SOUTH_SOUTH",
      "SOUTH_WEST",
    ]);
    expect(NIGERIA_GEO_URL).toBe("/ng-regions.json");
    expect(isNigeriaRegion("SOUTH_SOUTH")).toBe(true);
    expect(isNigeriaRegion("WALES")).toBe(false);
  });

  it("every shard feature is tagged with a regionCode in NG_REGION_CODES", () => {
    const gj = JSON.parse(readFileSync("public/ng-regions.json", "utf8"));
    const codes = new Set<string>(NG_REGION_CODES);
    for (const f of gj.features) {
      expect(f.properties?.regionCode, JSON.stringify(f.properties)).toBeDefined();
      expect(codes.has(f.properties.regionCode)).toBe(true);
    }
  });
});
