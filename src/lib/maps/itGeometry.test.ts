import { describe, expect, it } from "vitest";
import { IT_GEO_URL, IT_LABEL_OVERRIDES, IT_REGION_CODES, isItalyRegion } from "./itGeometry";
import { itRegions } from "@/lib/seeds/it/itRegions";
import { itRegions1953 } from "@/lib/seeds/it/itRegions1953";

describe("itGeometry", () => {
  it("codes exactly match the IT seed roster (both eras)", () => {
    const seed = itRegions.map((r) => r._id).sort();
    const seed1953 = itRegions1953.map((r) => r._id).sort();
    expect([...IT_REGION_CODES].sort()).toEqual(seed);
    expect([...IT_REGION_CODES].sort()).toEqual(seed1953);
  });

  it("codes are unique and non-empty", () => {
    expect(new Set(IT_REGION_CODES).size).toBe(IT_REGION_CODES.length);
    expect(IT_REGION_CODES.length).toBe(8);
    expect(IT_GEO_URL).toBe("/it-regions.json");
  });

  it("isItalyRegion accepts shard codes and rejects others", () => {
    for (const code of IT_REGION_CODES) expect(isItalyRegion(code)).toBe(true);
    expect(isItalyRegion("TR_IST")).toBe(false);
    expect(isItalyRegion("")).toBe(false);
  });

  it("label overrides only reference real codes", () => {
    for (const code of Object.keys(IT_LABEL_OVERRIDES)) {
      expect(isItalyRegion(code)).toBe(true);
    }
  });
});
