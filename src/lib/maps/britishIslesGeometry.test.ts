import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { BRITISH_ISLES_REGION_CODES, isBritishIslesRegion } from "./britishIslesGeometry";

describe("britishIslesGeometry", () => {
  it("lists 20 British-Isles region codes incl. NIR + the 8 IE regions", () => {
    expect(BRITISH_ISLES_REGION_CODES).toHaveLength(20);
    for (const c of ["NIR", "SCO", "WAL", "LON", "DUB", "COR"]) {
      expect(BRITISH_ISLES_REGION_CODES).toContain(c);
    }
    expect(isBritishIslesRegion("NIR")).toBe(true);
    expect(isBritishIslesRegion("CA")).toBe(false);
  });

  it("the committed geojson tags every feature with a known regionCode + geometry", () => {
    const geo = JSON.parse(readFileSync("public/british-isles-regions.json", "utf8"));
    expect(geo.features).toHaveLength(20);
    for (const f of geo.features) {
      expect(BRITISH_ISLES_REGION_CODES).toContain(f.properties.regionCode);
      expect(f.geometry?.coordinates?.length).toBeGreaterThan(0);
    }
  });
});
