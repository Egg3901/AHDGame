import { describe, expect, it } from "vitest";
import {
  CS_GEO_URL,
  CS_LABEL_OVERRIDES,
  CS_REGION_CODES,
  isCzechoslovakiaRegion,
} from "./csGeometry";
import { csRegions } from "@/lib/seeds/cs/csRegions";
import { csRegions1953 } from "@/lib/seeds/cs/csRegions1953";

describe("csGeometry", () => {
  it("codes exactly match the CS seed roster (both eras)", () => {
    const seed = csRegions.map((r) => r._id).sort();
    const seed1953 = csRegions1953.map((r) => r._id).sort();
    expect([...CS_REGION_CODES].sort()).toEqual(seed);
    expect([...CS_REGION_CODES].sort()).toEqual(seed1953);
  });

  it("codes are unique and non-empty", () => {
    expect(new Set(CS_REGION_CODES).size).toBe(CS_REGION_CODES.length);
    expect(CS_REGION_CODES.length).toBe(4);
    expect(CS_GEO_URL).toBe("/cs-regions.json");
  });

  it("isCzechoslovakiaRegion accepts shard codes and rejects others", () => {
    for (const code of CS_REGION_CODES) expect(isCzechoslovakiaRegion(code)).toBe(true);
    expect(isCzechoslovakiaRegion("YU_SLO")).toBe(false);
    expect(isCzechoslovakiaRegion("")).toBe(false);
  });

  it("label overrides only reference real codes", () => {
    for (const code of Object.keys(CS_LABEL_OVERRIDES)) {
      expect(isCzechoslovakiaRegion(code)).toBe(true);
    }
  });
});
