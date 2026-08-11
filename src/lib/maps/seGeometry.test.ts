import { describe, expect, it } from "vitest";
import { SE_GEO_URL, SE_LABEL_OVERRIDES, SE_REGION_CODES, isSwedenRegion } from "./seGeometry";
import { seRegions } from "@/lib/seeds/se/seRegions";
import { seRegions1953 } from "@/lib/seeds/se/seRegions1953";

describe("seGeometry", () => {
  it("codes exactly match the SE seed roster (both eras)", () => {
    const seed = seRegions.map((r) => r._id).sort();
    const seed1953 = seRegions1953.map((r) => r._id).sort();
    expect([...SE_REGION_CODES].sort()).toEqual(seed);
    expect([...SE_REGION_CODES].sort()).toEqual(seed1953);
  });

  it("codes are unique and non-empty", () => {
    expect(new Set(SE_REGION_CODES).size).toBe(SE_REGION_CODES.length);
    expect(SE_REGION_CODES.length).toBe(8);
    expect(SE_GEO_URL).toBe("/se-regions.json");
  });

  it("isSwedenRegion accepts shard codes and rejects others", () => {
    for (const code of SE_REGION_CODES) expect(isSwedenRegion(code)).toBe(true);
    expect(isSwedenRegion("ES_MAD")).toBe(false);
    expect(isSwedenRegion("")).toBe(false);
  });

  it("label overrides only reference real codes", () => {
    for (const code of Object.keys(SE_LABEL_OVERRIDES)) {
      expect(isSwedenRegion(code)).toBe(true);
    }
  });
});
