import { describe, it, expect } from "vitest";
import { STRATEGIC_REGIONS, getRegion, groupRegionsByTheater } from "../regions";

describe("strategic regions", () => {
  it("defines the 19 mockup regions with unique ids", () => {
    expect(STRATEGIC_REGIONS).toHaveLength(19);
    const ids = new Set(STRATEGIC_REGIONS.map((r) => r.id));
    expect(ids.size).toBe(19);
    expect(getRegion("mea")?.name).toBe("Middle East");
  });

  it("groups regions by theater (macro) preserving membership", () => {
    const groups = groupRegionsByTheater(STRATEGIC_REGIONS);
    const total = groups.reduce((n, g) => n + g.regions.length, 0);
    expect(total).toBe(19);
    const indo = groups.find((g) => g.theater === "Indo-Pacific");
    expect(indo?.regions.map((r) => r.id)).toContain("wpa");
  });
});
