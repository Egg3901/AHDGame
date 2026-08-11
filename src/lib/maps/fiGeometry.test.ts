import { describe, expect, it } from "vitest";
import { FI_GEO_URL, FI_LABEL_OVERRIDES, FI_REGION_CODES, isFinlandRegion } from "./fiGeometry";
import { fiRegions } from "@/lib/seeds/fi/fiRegions";
import { fiRegions1953 } from "@/lib/seeds/fi/fiRegions1953";

describe("fiGeometry", () => {
  it("codes exactly match the FI seed roster (both eras)", () => {
    const seed = fiRegions.map((r) => r._id).sort();
    const seed1953 = fiRegions1953.map((r) => r._id).sort();
    expect([...FI_REGION_CODES].sort()).toEqual(seed);
    expect([...FI_REGION_CODES].sort()).toEqual(seed1953);
  });

  it("codes are unique and non-empty", () => {
    expect(new Set(FI_REGION_CODES).size).toBe(FI_REGION_CODES.length);
    expect(FI_REGION_CODES.length).toBe(6);
    expect(FI_GEO_URL).toBe("/fi-regions.json");
  });

  it("isFinlandRegion accepts shard codes and rejects others", () => {
    for (const code of FI_REGION_CODES) expect(isFinlandRegion(code)).toBe(true);
    expect(isFinlandRegion("AT_VIE")).toBe(false);
    expect(isFinlandRegion("")).toBe(false);
  });

  it("label overrides only reference real codes", () => {
    for (const code of Object.keys(FI_LABEL_OVERRIDES)) {
      expect(isFinlandRegion(code)).toBe(true);
    }
  });
});
