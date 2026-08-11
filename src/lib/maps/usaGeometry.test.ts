import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { US_REGION_CODES, USA_GEO_URL, isUSRegion } from "./usaGeometry";

describe("usaGeometry", () => {
  it("covers all 50 states + DC", () => {
    expect(US_REGION_CODES).toHaveLength(51);
    expect(new Set(US_REGION_CODES).size).toBe(51);
    expect(US_REGION_CODES).toContain("DC");
    expect(US_REGION_CODES).toContain("CA");
    expect(isUSRegion("TX")).toBe(true);
    expect(isUSRegion("NIR")).toBe(false);
  });

  it("the built shard tags every state with a known regionCode, each with geometry", () => {
    const geo = JSON.parse(readFileSync(`public${USA_GEO_URL}`, "utf8"));
    expect(geo.features).toHaveLength(51);
    const codes = geo.features.map(
      (f: { properties: { regionCode: string } }) => f.properties.regionCode
    );
    expect(new Set(codes)).toEqual(new Set(US_REGION_CODES));
    for (const f of geo.features) {
      expect(US_REGION_CODES).toContain(f.properties.regionCode);
      expect(f.geometry?.coordinates?.length).toBeGreaterThan(0);
    }
  });
});
