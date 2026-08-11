import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { RU_REGION_CODES, RU_LABEL_OVERRIDES, isSovietRegion } from "./ruGeometry";
import { ruRegions } from "@/lib/seeds/ru/ruRegions";

describe("ruGeometry", () => {
  it("lists the 14 USSR macro-region codes (bare, no SU_ prefix)", () => {
    // 17 before Ukraine, Byelorussia and the Baltics were promoted to their own
    // countries with their own shards (ua/blr/bal-regions.json).
    expect(RU_REGION_CODES).toHaveLength(14);
    expect(new Set(RU_REGION_CODES).size).toBe(14);
    expect(RU_REGION_CODES.some((c) => c.startsWith("SU_"))).toBe(false);
    expect(isSovietRegion("NOR")).toBe(true);
    expect(isSovietRegion("SU_NOR")).toBe(false);
  });

  it("matches the seed region ids exactly (rename stays consistent)", () => {
    expect(new Set(ruRegions.map((r) => r._id))).toEqual(new Set(RU_REGION_CODES));
  });

  it("has a compact on-map label for every region", () => {
    for (const code of RU_REGION_CODES) {
      expect(RU_LABEL_OVERRIDES[code]).toBeTruthy();
    }
  });

  it("the committed shard tags every feature with a known regionCode (+ keeps id)", () => {
    const geo = JSON.parse(readFileSync("public/ru-regions.json", "utf8"));
    expect(geo.features).toHaveLength(14);
    const codes = geo.features.map(
      (f: { properties: { regionCode: string } }) => f.properties.regionCode
    );
    expect(new Set(codes)).toEqual(new Set(RU_REGION_CODES));
    for (const f of geo.features) {
      expect(f.properties.id).toBe(f.properties.regionCode);
      expect(f.geometry?.coordinates?.length).toBeGreaterThan(0);
    }
  });
});
