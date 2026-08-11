import { describe, expect, it } from "vitest";
import { HU_GEO_URL, HU_LABEL_OVERRIDES, HU_REGION_CODES, isHungaryRegion } from "./huGeometry";
import { huRegions } from "@/lib/seeds/hu/huRegions";
import { huRegions1953 } from "@/lib/seeds/hu/huRegions1953";

describe("huGeometry", () => {
  it("codes exactly match the HU seed roster (both eras)", () => {
    const seed = huRegions.map((r) => r._id).sort();
    const seed1953 = huRegions1953.map((r) => r._id).sort();
    expect([...HU_REGION_CODES].sort()).toEqual(seed);
    expect([...HU_REGION_CODES].sort()).toEqual(seed1953);
  });

  it("codes are unique and non-empty", () => {
    expect(new Set(HU_REGION_CODES).size).toBe(HU_REGION_CODES.length);
    expect(HU_REGION_CODES.length).toBe(6);
    expect(HU_GEO_URL).toBe("/hu-regions.json");
  });

  it("isHungaryRegion accepts shard codes and rejects others", () => {
    for (const code of HU_REGION_CODES) expect(isHungaryRegion(code)).toBe(true);
    expect(isHungaryRegion("BG_SOF")).toBe(false);
    expect(isHungaryRegion("")).toBe(false);
  });

  it("label overrides only reference real codes", () => {
    for (const code of Object.keys(HU_LABEL_OVERRIDES)) {
      expect(isHungaryRegion(code)).toBe(true);
    }
  });
});
