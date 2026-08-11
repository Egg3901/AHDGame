import { describe, expect, it } from "vitest";
import { AT_GEO_URL, AT_LABEL_OVERRIDES, AT_REGION_CODES, isAustriaRegion } from "./atGeometry";
import { atRegions } from "@/lib/seeds/at/atRegions";
import { atRegions1953 } from "@/lib/seeds/at/atRegions1953";

describe("atGeometry", () => {
  it("codes exactly match the AT seed roster (both eras)", () => {
    const seed = atRegions.map((r) => r._id).sort();
    const seed1953 = atRegions1953.map((r) => r._id).sort();
    expect([...AT_REGION_CODES].sort()).toEqual(seed);
    expect([...AT_REGION_CODES].sort()).toEqual(seed1953);
  });

  it("codes are unique and non-empty", () => {
    expect(new Set(AT_REGION_CODES).size).toBe(AT_REGION_CODES.length);
    expect(AT_REGION_CODES.length).toBe(5);
    expect(AT_GEO_URL).toBe("/at-regions.json");
  });

  it("isAustriaRegion accepts shard codes and rejects others", () => {
    for (const code of AT_REGION_CODES) expect(isAustriaRegion(code)).toBe(true);
    expect(isAustriaRegion("GR_ATT")).toBe(false);
    expect(isAustriaRegion("")).toBe(false);
  });

  it("label overrides only reference real codes", () => {
    for (const code of Object.keys(AT_LABEL_OVERRIDES)) {
      expect(isAustriaRegion(code)).toBe(true);
    }
  });
});
