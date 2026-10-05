import { describe, expect, it } from "vitest";
import { deriveRegionalTexture1991 } from "../derive/opening1991";
import { REGIONAL_TEXTURE_1991 } from "./regionalTexture1991";
import { NATIONAL_BASELINES_1991, OPENING_POLITICAL_APPROVAL_1991 } from "./nationalBaselines1991";
import { approvalComponent } from "@/lib/politicalLegislation/politicalApproval";
import { getCatalog, baselineLevelFor } from "@/lib/politicalLegislation/catalog";
import { BASELINE_LEVEL_OVERRIDES_1991 } from "@/lib/politicalLegislation/seeds/baselineLevels1991";
import { US_GEOGRAPHY } from "@/lib/countries/us/geography";
import { UK_GEOGRAPHY } from "@/lib/countries/uk/geography";
import type { PoliticalMetricId } from "../types";

describe("1991 political opening qualification", () => {
  it("regenerates every emitted texture cell from committed 1991 sources", () => {
    expect(deriveRegionalTexture1991()).toEqual(REGIONAL_TEXTURE_1991);
  });
  for (const cc of ["US", "UK"] as const) {
    it(`preserves ${cc}'s national levels with distinct regional profiles`, () => {
      const regions = (cc === "US" ? US_GEOGRAPHY : UK_GEOGRAPHY).regionBundles["1991-default"];
      if (!regions?.length) throw new Error(`Missing ${cc} 1991 regions`);
      expect(Object.keys(REGIONAL_TEXTURE_1991[cc]).sort()).toEqual(
        regions.map((r) => r._id).sort()
      );
      expect(
        new Set(regions.map((region) => JSON.stringify(REGIONAL_TEXTURE_1991[cc][region._id]))).size
      ).toBeGreaterThanOrEqual(cc === "US" ? 15 : 12);
      const total = regions.reduce((sum, region) => sum + region.population, 0);
      for (const id of Object.keys(NATIONAL_BASELINES_1991[cc]) as PoliticalMetricId[]) {
        const delta =
          regions.reduce(
            (sum, region) =>
              sum + (REGIONAL_TEXTURE_1991[cc][region._id][id] ?? 0) * region.population,
            0
          ) / total;
        expect(Math.abs(delta)).toBeLessThanOrEqual(0.051);
        for (const region of regions) {
          const value =
            NATIONAL_BASELINES_1991[cc][id] + (REGIONAL_TEXTURE_1991[cc][region._id][id] ?? 0);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(100);
        }
      }
    });
  }
  it("calibrates country-specific starting difficulty without changing 1953", () => {
    for (const cc of ["US", "UK", "RU"] as const) {
      expect(
        50 + approvalComponent(NATIONAL_BASELINES_1991[cc], 0, cc, "1991-default")
      ).toBeCloseTo(OPENING_POLITICAL_APPROVAL_1991[cc]!);
    }
  });
  it("authors valid 1991 levels without changing the 1953 book", () => {
    const laws = ["US", "UK", "RU"].flatMap((cc) => getCatalog(cc));
    for (const [id, level] of Object.entries(BASELINE_LEVEL_OVERRIDES_1991)) {
      const law = laws.find((law) => law.id === id);
      expect(law, id).toBeDefined();
      expect(baselineLevelFor(law!, 1991)).toBe(level);
      expect(baselineLevelFor(law!, 1953)).toBe(law!.baselineLevel ?? 0);
    }
  });
});
