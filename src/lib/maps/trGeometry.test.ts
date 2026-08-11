import { describe, expect, it } from "vitest";
import { TR_GEO_URL, TR_LABEL_OVERRIDES, TR_REGION_CODES, isTurkeyRegion } from "./trGeometry";
import { trRegions } from "@/lib/seeds/tr/trRegions";
import { trRegions1953 } from "@/lib/seeds/tr/trRegions1953";

describe("trGeometry", () => {
  it("codes exactly match the TR seed roster (both eras)", () => {
    const seed = trRegions.map((r) => r._id).sort();
    const seed1953 = trRegions1953.map((r) => r._id).sort();
    expect([...TR_REGION_CODES].sort()).toEqual(seed);
    expect([...TR_REGION_CODES].sort()).toEqual(seed1953);
  });

  it("codes are unique and non-empty", () => {
    expect(new Set(TR_REGION_CODES).size).toBe(TR_REGION_CODES.length);
    expect(TR_REGION_CODES.length).toBe(8);
    expect(TR_GEO_URL).toBe("/tr-regions.json");
  });

  it("isTurkeyRegion accepts shard codes and rejects others", () => {
    for (const code of TR_REGION_CODES) expect(isTurkeyRegion(code)).toBe(true);
    expect(isTurkeyRegion("NORTE")).toBe(false);
    expect(isTurkeyRegion("")).toBe(false);
  });

  it("label overrides only reference real codes", () => {
    for (const code of Object.keys(TR_LABEL_OVERRIDES)) {
      expect(isTurkeyRegion(code)).toBe(true);
    }
  });
});
