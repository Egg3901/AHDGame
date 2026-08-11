import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  GERMANY_REGION_CODES,
  WEST_DE_REGION_CODES,
  EAST_DE_REGION_CODES,
  isGermanyRegion,
} from "./germanyGeometry";

describe("germanyGeometry", () => {
  it("lists 16 German region codes = 11 western + 5 eastern, disjoint, no dupes", () => {
    expect(WEST_DE_REGION_CODES).toHaveLength(11);
    expect(EAST_DE_REGION_CODES).toHaveLength(5);
    expect(GERMANY_REGION_CODES).toHaveLength(16);
    expect(new Set(GERMANY_REGION_CODES).size).toBe(16);
    // West and East are disjoint.
    for (const c of EAST_DE_REGION_CODES) expect(WEST_DE_REGION_CODES).not.toContain(c);
    // The five eastern (GDR-in-1979) codes.
    for (const c of ["BB", "MV", "SN", "ST", "TH"]) expect(EAST_DE_REGION_CODES).toContain(c);
    expect(isGermanyRegion("BB")).toBe(true);
    expect(isGermanyRegion("BW")).toBe(true);
    expect(isGermanyRegion("NIR")).toBe(false);
  });

  it("uses the game's Bremen code (BRE) and keeps West Berlin (BE) as its own region", () => {
    expect(GERMANY_REGION_CODES).toContain("BRE");
    // HB is CN's Huabei code; Germany uses BRE for Bremen.
    expect(GERMANY_REGION_CODES).not.toContain("HB");
    // West Berlin (BE) is a distinct region/shape (the nation map draws it); the
    // world overlay folds it to Brandenburg's owner. East Berlin (BEO) has no shape.
    expect(WEST_DE_REGION_CODES).toContain("BE");
    expect(GERMANY_REGION_CODES).toContain("BE");
    expect(GERMANY_REGION_CODES).not.toContain("BEO");
  });

  it("the committed geojson tags every feature with a known regionCode + geometry", () => {
    const geo = JSON.parse(readFileSync("public/germany-regions.json", "utf8"));
    expect(geo.features).toHaveLength(16);
    const codes = geo.features.map(
      (f: { properties: { regionCode: string } }) => f.properties.regionCode
    );
    expect(new Set(codes)).toEqual(new Set(GERMANY_REGION_CODES));
    for (const f of geo.features) {
      expect(GERMANY_REGION_CODES).toContain(f.properties.regionCode);
      expect(f.geometry?.coordinates?.length).toBeGreaterThan(0);
    }
  });

  it("Brandenburg keeps its lone Berlin-enclave hole, and Berlin is a separate feature", () => {
    const geo = JSON.parse(readFileSync("public/germany-regions.json", "utf8"));
    const feat = (code: string) =>
      geo.features.find(
        (f: { properties: { regionCode: string } }) => f.properties.regionCode === code
      );
    const bb = feat("BB");
    const polys: number[][][][] =
      bb.geometry.type === "Polygon" ? [bb.geometry.coordinates] : bb.geometry.coordinates;
    const holes = polys.reduce((n, p) => n + (p.length - 1), 0);
    expect(holes).toBe(1); // the Berlin enclave — filled at world-overlay time by the BE→BB fold
    expect(feat("BE")).toBeTruthy(); // West Berlin is its own feature for the nation map
  });
});
