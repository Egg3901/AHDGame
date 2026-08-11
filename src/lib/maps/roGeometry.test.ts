import { describe, expect, it } from "vitest";
import { RO_GEO_URL, RO_LABEL_OVERRIDES, RO_REGION_CODES, isRomaniaRegion } from "./roGeometry";
import { roRegions } from "@/lib/seeds/ro/roRegions";
import { roRegions1953 } from "@/lib/seeds/ro/roRegions1953";

describe("roGeometry", () => {
  it("codes exactly match the RO seed roster (both eras)", () => {
    const seed = roRegions.map((r) => r._id).sort();
    const seed1953 = roRegions1953.map((r) => r._id).sort();
    expect([...RO_REGION_CODES].sort()).toEqual(seed);
    expect([...RO_REGION_CODES].sort()).toEqual(seed1953);
  });

  it("codes are unique and non-empty", () => {
    expect(new Set(RO_REGION_CODES).size).toBe(RO_REGION_CODES.length);
    expect(RO_REGION_CODES.length).toBe(7);
    expect(RO_GEO_URL).toBe("/ro-regions.json");
  });

  it("isRomaniaRegion accepts shard codes and rejects others", () => {
    for (const code of RO_REGION_CODES) expect(isRomaniaRegion(code)).toBe(true);
    expect(isRomaniaRegion("PL_MAZ")).toBe(false);
    expect(isRomaniaRegion("")).toBe(false);
  });

  it("label overrides only reference real codes", () => {
    for (const code of Object.keys(RO_LABEL_OVERRIDES)) {
      expect(isRomaniaRegion(code)).toBe(true);
    }
  });
});
