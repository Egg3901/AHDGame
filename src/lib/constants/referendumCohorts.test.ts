import { describe, it, expect } from "vitest";
import { cohortAffinitiesFor, REFERENDUM_COHORT_AFFINITY } from "./referendumCohorts";

describe("referendum cohort affinities", () => {
  it("exposes NIR affinities and returns {} for an unseeded region", () => {
    expect(REFERENDUM_COHORT_AFFINITY.NIR).toBeTruthy();
    expect(cohortAffinitiesFor("NIR")).toBe(REFERENDUM_COHORT_AFFINITY.NIR);
    expect(cohortAffinitiesFor("nir")).toBe(REFERENDUM_COHORT_AFFINITY.NIR);
    expect(cohortAffinitiesFor("ZZ")).toEqual({});
  });

  it("seeds SCO and WAL too", () => {
    expect(REFERENDUM_COHORT_AFFINITY.SCO).toBeTruthy();
    expect(REFERENDUM_COHORT_AFFINITY.WAL).toBeTruthy();
  });

  it("affinities are bounded relative offsets and use real uk_voterGroups ids", () => {
    const realIds = new Set([
      "urban_progressives",
      "rural_traditionalists",
      "retirees",
      "young_renters",
      "green_activists",
      "populist_right",
      "public_sector",
      "post_industrial_workers",
      "new_britons",
      "moderate_centrists",
      "small_business",
      "suburban_homeowners",
    ]);
    for (const region of Object.values(REFERENDUM_COHORT_AFFINITY)) {
      for (const [groupId, v] of Object.entries(region)) {
        expect(realIds.has(groupId)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(-50);
        expect(v).toBeLessThanOrEqual(50);
      }
    }
  });
});
