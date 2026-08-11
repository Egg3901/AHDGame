import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { BR_REGION_CODES, BR_LABEL_OVERRIDES, isBrazilRegion } from "./brazilGeometry";

describe("brazilGeometry", () => {
  it("lists the five Brazilian macro-region codes", () => {
    expect(BR_REGION_CODES).toHaveLength(5);
    expect(new Set(BR_REGION_CODES).size).toBe(5);
    expect(isBrazilRegion("NORTE")).toBe(true);
    expect(isBrazilRegion("NIR")).toBe(false);
  });

  it("has a compact on-map label for every region", () => {
    for (const code of BR_REGION_CODES) {
      expect(BR_LABEL_OVERRIDES[code]).toBeTruthy();
    }
  });

  it("the committed shard tags every feature with a known regionCode (+ keeps id for legacy consumers)", () => {
    const geo = JSON.parse(readFileSync("public/br-regions.json", "utf8"));
    expect(geo.features).toHaveLength(5);
    const codes = geo.features.map(
      (f: { properties: { regionCode: string } }) => f.properties.regionCode
    );
    expect(new Set(codes)).toEqual(new Set(BR_REGION_CODES));
    for (const f of geo.features) {
      expect(BR_REGION_CODES).toContain(f.properties.regionCode);
      // RegionMapPaths still reads `id`; tagging must not have dropped it.
      expect(f.properties.id).toBe(f.properties.regionCode);
      expect(f.geometry?.coordinates?.length).toBeGreaterThan(0);
    }
  });
});
