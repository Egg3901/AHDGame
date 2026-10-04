import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import {
  BG_GEO_URL,
  BG_GEO_URL_2027,
  BG_LABEL_OVERRIDES,
  BG_REGION_CODES,
  BG_REGION_CODES_2027,
  bgGeoUrlForRegions,
  isBulgariaRegion,
} from "./bgGeometry";
import { bgRegions } from "@/lib/seeds/bg/bgRegions";
import { bgRegions1953 } from "@/lib/seeds/bg/bgRegions1953";
import { bgRegions2027 } from "@/lib/countries/bg/data/bgRegions2027";
import { bgRegions1991 } from "@/lib/countries/bg/data/bgRegions1991";
import { shardForRegion } from "./regionManifest";

describe("bgGeometry", () => {
  it("codes exactly match the historic BG seed rosters", () => {
    const seed = bgRegions.map((r) => r._id).sort();
    const seed1953 = bgRegions1953.map((r) => r._id).sort();
    const seed1991 = bgRegions1991.map((r) => r._id).sort();
    expect([...BG_REGION_CODES].sort()).toEqual(seed);
    expect([...BG_REGION_CODES].sort()).toEqual(seed1953);
    expect([...BG_REGION_CODES].sort()).toEqual(seed1991);
  });

  it("codes are unique and non-empty", () => {
    expect(new Set(BG_REGION_CODES).size).toBe(BG_REGION_CODES.length);
    expect(BG_REGION_CODES.length).toBe(5);
    expect(BG_GEO_URL).toBe("/bg-regions.json");
  });

  it("isBulgariaRegion accepts shard codes and rejects others", () => {
    for (const code of BG_REGION_CODES) expect(isBulgariaRegion(code)).toBe(true);
    expect(isBulgariaRegion("CS_BOH")).toBe(false);
    expect(isBulgariaRegion("")).toBe(false);
  });

  it("label overrides only reference real codes", () => {
    for (const code of Object.keys(BG_LABEL_OVERRIDES)) {
      expect(isBulgariaRegion(code)).toBe(true);
    }
  });

  it("maps 2027 seeded IDs to matching feature IDs and manifest lookups", () => {
    const seeded = bgRegions2027.map((r) => r._id).sort();
    expect([...BG_REGION_CODES_2027].sort()).toEqual(seeded);
    const geo = JSON.parse(readFileSync(`public${BG_GEO_URL_2027}`, "utf8"));
    expect(geo.features.map((f: { id: string }) => f.id).sort()).toEqual(seeded);
    for (const feature of geo.features) {
      expect(feature.properties.id).toBe(feature.id);
      expect(feature.properties.regionCode).toBe(feature.id);
      expect(feature.geometry.coordinates.length).toBeGreaterThan(0);
      expect(shardForRegion(feature.id)?.url).toBe(BG_GEO_URL_2027);
      expect(isBulgariaRegion(feature.id)).toBe(true);
    }
  });

  it("selects geography from live IDs while preserving historic maps", () => {
    expect(bgGeoUrlForRegions(bgRegions1953.map((r) => r._id))).toBe(BG_GEO_URL);
    expect(bgGeoUrlForRegions(bgRegions1991.map((r) => r._id))).toBe(BG_GEO_URL);
    expect(bgGeoUrlForRegions(bgRegions.map((r) => r._id))).toBe(BG_GEO_URL);
    expect(bgGeoUrlForRegions(bgRegions2027.map((r) => r._id))).toBe(BG_GEO_URL_2027);
  });
});
