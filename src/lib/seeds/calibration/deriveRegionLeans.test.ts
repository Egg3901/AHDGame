import { describe, it, expect } from "vitest";
import { deriveRegionLeans } from "./deriveRegionLeans";

describe("deriveRegionLeans", () => {
  it("returns one lean row per US state for 1991", () => {
    const rows = deriveRegionLeans("US", "1991");
    expect(rows.length).toBe(51);
    const dc = rows.find((r) => r.regionId === "DC");
    expect(dc).toBeDefined();
    // every value on the −5..+5 derived scale
    for (const r of rows) {
      expect(r.display).toBeGreaterThanOrEqual(-5);
      expect(r.display).toBeLessThanOrEqual(5);
    }
  });

  it("returns rows for an international country (BR 1991)", () => {
    const rows = deriveRegionLeans("BR", "1991");
    expect(rows.length).toBeGreaterThan(0);
  });
});
