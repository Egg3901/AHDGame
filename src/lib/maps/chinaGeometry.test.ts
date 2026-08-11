import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  CHINA_GEO_URL,
  CHINA_GEO_URL_PRE_HANDOVER,
  CN_REGION_CODES,
  isChinaRegion,
} from "./chinaGeometry";

describe("chinaGeometry", () => {
  it("lists the seven Chinese macro-region codes", () => {
    expect(CN_REGION_CODES).toHaveLength(7);
    expect(new Set(CN_REGION_CODES).size).toBe(7);
    // HB is CN Huabei (NOT German Bremen, which is BRE) — the macro-region set.
    expect(CN_REGION_CODES).toContain("HB");
    expect(isChinaRegion("DB")).toBe(true);
    expect(isChinaRegion("BRE")).toBe(false);
  });

  it("both era shards carry the SAME seven codes (handover changes shape, not the set)", () => {
    for (const url of [CHINA_GEO_URL, CHINA_GEO_URL_PRE_HANDOVER]) {
      const geo = JSON.parse(readFileSync(`public${url}`, "utf8"));
      expect(geo.features).toHaveLength(7);
      const codes = geo.features.map(
        (f: { properties: { regionCode: string } }) => f.properties.regionCode
      );
      expect(new Set(codes)).toEqual(new Set(CN_REGION_CODES));
      for (const f of geo.features) {
        // RegionMapPaths still reads `id`; tagging must not have dropped it.
        expect(f.properties.id).toBe(f.properties.regionCode);
        expect(f.geometry?.coordinates?.length).toBeGreaterThan(0);
      }
    }
  });
});
