import { describe, expect, it } from "vitest";
import { ES_GEO_URL, ES_LABEL_OVERRIDES, ES_REGION_CODES, isSpainRegion } from "./esGeometry";
import { esRegions } from "@/lib/seeds/es/esRegions";
import { esRegions1953 } from "@/lib/seeds/es/esRegions1953";

describe("esGeometry", () => {
  it("codes exactly match the ES seed roster (both eras)", () => {
    const seed = esRegions.map((r) => r._id).sort();
    const seed1953 = esRegions1953.map((r) => r._id).sort();
    expect([...ES_REGION_CODES].sort()).toEqual(seed);
    expect([...ES_REGION_CODES].sort()).toEqual(seed1953);
  });

  it("codes are unique and non-empty", () => {
    expect(new Set(ES_REGION_CODES).size).toBe(ES_REGION_CODES.length);
    expect(ES_REGION_CODES.length).toBe(8);
    expect(ES_GEO_URL).toBe("/es-regions.json");
  });

  it("isSpainRegion accepts shard codes and rejects others", () => {
    for (const code of ES_REGION_CODES) expect(isSpainRegion(code)).toBe(true);
    expect(isSpainRegion("FR_IDF")).toBe(false);
    expect(isSpainRegion("")).toBe(false);
  });

  it("label overrides only reference real codes", () => {
    for (const code of Object.keys(ES_LABEL_OVERRIDES)) {
      expect(isSpainRegion(code)).toBe(true);
    }
  });
});
