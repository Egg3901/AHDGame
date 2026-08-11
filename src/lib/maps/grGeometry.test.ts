import { describe, expect, it } from "vitest";
import { GR_GEO_URL, GR_LABEL_OVERRIDES, GR_REGION_CODES, isGreeceRegion } from "./grGeometry";
import { grRegions } from "@/lib/seeds/gr/grRegions";
import { grRegions1953 } from "@/lib/seeds/gr/grRegions1953";

describe("grGeometry", () => {
  it("codes exactly match the GR seed roster (both eras)", () => {
    const seed = grRegions.map((r) => r._id).sort();
    const seed1953 = grRegions1953.map((r) => r._id).sort();
    expect([...GR_REGION_CODES].sort()).toEqual(seed);
    expect([...GR_REGION_CODES].sort()).toEqual(seed1953);
  });

  it("codes are unique and non-empty", () => {
    expect(new Set(GR_REGION_CODES).size).toBe(GR_REGION_CODES.length);
    expect(GR_REGION_CODES.length).toBe(6);
    expect(GR_GEO_URL).toBe("/gr-regions.json");
  });

  it("isGreeceRegion accepts shard codes and rejects others", () => {
    for (const code of GR_REGION_CODES) expect(isGreeceRegion(code)).toBe(true);
    expect(isGreeceRegion("TR_IST")).toBe(false);
    expect(isGreeceRegion("")).toBe(false);
  });

  it("label overrides only reference real codes", () => {
    for (const code of Object.keys(GR_LABEL_OVERRIDES)) {
      expect(isGreeceRegion(code)).toBe(true);
    }
  });
});
