import { describe, expect, it } from "vitest";
import { FR_GEO_URL, FR_LABEL_OVERRIDES, FR_REGION_CODES, isFranceRegion } from "./frGeometry";
import { frRegions } from "@/lib/seeds/fr/frRegions";
import { frRegions1953 } from "@/lib/seeds/fr/frRegions1953";

describe("frGeometry", () => {
  it("codes exactly match the FR seed roster (both eras)", () => {
    const seed = frRegions.map((r) => r._id).sort();
    const seed1953 = frRegions1953.map((r) => r._id).sort();
    expect([...FR_REGION_CODES].sort()).toEqual(seed);
    expect([...FR_REGION_CODES].sort()).toEqual(seed1953);
  });

  it("codes are unique and non-empty", () => {
    expect(new Set(FR_REGION_CODES).size).toBe(FR_REGION_CODES.length);
    expect(FR_REGION_CODES.length).toBe(8);
    expect(FR_GEO_URL).toBe("/fr-regions.json");
  });

  it("isFranceRegion accepts shard codes and rejects others", () => {
    for (const code of FR_REGION_CODES) expect(isFranceRegion(code)).toBe(true);
    expect(isFranceRegion("IT_LAZ")).toBe(false);
    expect(isFranceRegion("")).toBe(false);
  });

  it("label overrides only reference real codes", () => {
    for (const code of Object.keys(FR_LABEL_OVERRIDES)) {
      expect(isFranceRegion(code)).toBe(true);
    }
  });
});
