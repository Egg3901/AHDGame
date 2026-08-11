import { describe, expect, it } from "vitest";
import { PL_GEO_URL, PL_LABEL_OVERRIDES, PL_REGION_CODES, isPolandRegion } from "./plGeometry";
import { plRegions } from "@/lib/seeds/pl/plRegions";
import { plRegions1953 } from "@/lib/seeds/pl/plRegions1953";

describe("plGeometry", () => {
  it("codes exactly match the PL seed roster (both eras)", () => {
    const seed = plRegions.map((r) => r._id).sort();
    const seed1953 = plRegions1953.map((r) => r._id).sort();
    expect([...PL_REGION_CODES].sort()).toEqual(seed);
    expect([...PL_REGION_CODES].sort()).toEqual(seed1953);
  });

  it("codes are unique and non-empty", () => {
    expect(new Set(PL_REGION_CODES).size).toBe(PL_REGION_CODES.length);
    expect(PL_REGION_CODES.length).toBe(8);
    expect(PL_GEO_URL).toBe("/pl-regions.json");
  });

  it("isPolandRegion accepts shard codes and rejects others", () => {
    for (const code of PL_REGION_CODES) expect(isPolandRegion(code)).toBe(true);
    expect(isPolandRegion("HU_BUD")).toBe(false);
    expect(isPolandRegion("")).toBe(false);
  });

  it("label overrides only reference real codes", () => {
    for (const code of Object.keys(PL_LABEL_OVERRIDES)) {
      expect(isPolandRegion(code)).toBe(true);
    }
  });
});
