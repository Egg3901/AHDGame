import { describe, expect, it } from "vitest";
import { BG_GEO_URL, BG_LABEL_OVERRIDES, BG_REGION_CODES, isBulgariaRegion } from "./bgGeometry";
import { bgRegions } from "@/lib/seeds/bg/bgRegions";
import { bgRegions1953 } from "@/lib/seeds/bg/bgRegions1953";

describe("bgGeometry", () => {
  it("codes exactly match the BG seed roster (both eras)", () => {
    const seed = bgRegions.map((r) => r._id).sort();
    const seed1953 = bgRegions1953.map((r) => r._id).sort();
    expect([...BG_REGION_CODES].sort()).toEqual(seed);
    expect([...BG_REGION_CODES].sort()).toEqual(seed1953);
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
});
