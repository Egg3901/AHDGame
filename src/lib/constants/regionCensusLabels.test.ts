import { describe, it, expect } from "vitest";
import { REGION_CENSUS_LABELS } from "./regionCensusLabels";

const ARCHETYPE_COUNTRIES = ["UK", "JP", "DE", "IE", "CN", "BR"] as const;

describe("REGION_CENSUS_LABELS", () => {
  it("has a complete label set for every archetype country", () => {
    for (const cc of ARCHETYPE_COUNTRIES) {
      const set = REGION_CENSUS_LABELS[cc];
      expect(set, `${cc} label set`).toBeDefined();
      for (const dim of ["ethnicity", "age", "education", "income", "urbanization"] as const) {
        expect(set!.cardTitles[dim], `${cc} cardTitle ${dim}`).toBeTruthy();
        expect(Object.keys(set![dim]).length, `${cc} ${dim} labels`).toBeGreaterThan(0);
      }
    }
  });

  it("uses era-neutral income tiers everywhere", () => {
    for (const cc of ARCHETYPE_COUNTRIES) {
      expect(REGION_CENSUS_LABELS[cc]!.income).toEqual({
        low: "Lower income",
        middle: "Middle income",
        high: "Upper income",
      });
    }
  });

  it("age labels are the canonical four buckets", () => {
    for (const cc of ARCHETYPE_COUNTRIES) {
      expect(Object.keys(REGION_CENSUS_LABELS[cc]!.age).sort()).toEqual([
        "mature",
        "mid",
        "senior",
        "young",
      ]);
    }
  });
});
