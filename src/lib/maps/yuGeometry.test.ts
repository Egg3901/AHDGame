import { describe, expect, it } from "vitest";
import { YU_GEO_URL, YU_LABEL_OVERRIDES, YU_REGION_CODES, isYugoslaviaRegion } from "./yuGeometry";
import { yuRegions } from "@/lib/seeds/yu/yuRegions";
import { yuRegions1953 } from "@/lib/seeds/yu/yuRegions1953";

describe("yuGeometry", () => {
  it("codes exactly match the YU seed roster (both eras)", () => {
    const seed = yuRegions.map((r) => r._id).sort();
    const seed1953 = yuRegions1953.map((r) => r._id).sort();
    expect([...YU_REGION_CODES].sort()).toEqual(seed);
    expect([...YU_REGION_CODES].sort()).toEqual(seed1953);
  });

  it("codes are unique and non-empty", () => {
    expect(new Set(YU_REGION_CODES).size).toBe(YU_REGION_CODES.length);
    expect(YU_REGION_CODES.length).toBe(8);
    expect(YU_GEO_URL).toBe("/yu-regions.json");
  });

  it("isYugoslaviaRegion accepts shard codes and rejects others", () => {
    for (const code of YU_REGION_CODES) expect(isYugoslaviaRegion(code)).toBe(true);
    expect(isYugoslaviaRegion("SE_STH")).toBe(false);
    expect(isYugoslaviaRegion("")).toBe(false);
  });

  it("label overrides only reference real codes", () => {
    for (const code of Object.keys(YU_LABEL_OVERRIDES)) {
      expect(isYugoslaviaRegion(code)).toBe(true);
    }
  });
});
