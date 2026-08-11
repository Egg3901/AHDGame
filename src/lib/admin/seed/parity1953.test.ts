/**
 * The safety property for the era refactor: at 1953 the year-driven path must
 * produce exactly what the flat 1953 tables produced. Any diff is a bug.
 */
import { describe, expect, it } from "vitest";
import { baselineFor, validateAnchorTable } from "@/lib/politicalMetrics/seeds/baselineAnchors";
import { NATIONAL_BASELINES_1953 } from "@/lib/politicalMetrics/seeds/nationalBaselines1953";
import { POLITICAL_METRIC_COUNTRY_IDS, type PoliticalMetricId } from "@/lib/politicalMetrics/types";
import { getCatalog, baselineLevelFor } from "@/lib/politicalLegislation/catalog";
import { LAW_COUNTRY_IDS } from "@/lib/politicalLegislation/types";

describe("1953 parity", () => {
  it("the anchor table is structurally valid", () => {
    expect(validateAnchorTable()).toEqual([]);
  });

  it("every family resolves to its authored 1953 value", () => {
    for (const countryId of POLITICAL_METRIC_COUNTRY_IDS) {
      for (const [metricId, baseline] of Object.entries(NATIONAL_BASELINES_1953[countryId])) {
        expect(
          baselineFor(countryId, metricId as PoliticalMetricId, 1953),
          `${countryId} ${metricId}`
        ).toBe(baseline.value);
      }
    }
  });

  it("every law is active at 1953 and seeds at its authored baseline level", () => {
    for (const countryId of LAW_COUNTRY_IDS) {
      const unfiltered = getCatalog(countryId);
      const at1953 = getCatalog(countryId, 1953);
      expect(at1953.map((l) => l.id)).toEqual(unfiltered.map((l) => l.id));
      for (const law of at1953) {
        if (law.kind === "tax") continue;
        expect(baselineLevelFor(law, 1953), law.id).toBe(law.baselineLevel ?? 0);
      }
    }
  });
});
