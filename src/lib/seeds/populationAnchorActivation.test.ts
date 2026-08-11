import { describe, expect, it } from "vitest";
import { applyEra1991Adjustments } from "@/lib/seeds/reference/stateMetrics1991";
import { ieStateMetrics } from "@/lib/seeds/ie/ieStateMetrics";
import { jpStateMetrics } from "@/lib/seeds/jp/jpStateMetrics";
import { brStateMetrics } from "@/lib/seeds/br/brStateMetrics";
import { cnStateMetrics } from "@/lib/seeds/cn/cnStateMetrics";
import { ukStateMetrics } from "@/lib/seeds/uk/ukStateMetrics";
import { iePopulationAnchors1991 } from "@/lib/seeds/ie/iePopulationAnchors";
import { jpPopulationAnchors1991 } from "@/lib/seeds/jp/jpPopulationAnchors";
import { brPopulationAnchors1991 } from "@/lib/seeds/br/brPopulationAnchors";
import { cnPopulationAnchors1991 } from "@/lib/seeds/cn/cnPopulationAnchors";
import { ukPopulationAnchors1991 } from "@/lib/seeds/uk/ukPopulationAnchors";

/**
 * Regression: the seed-metric constants must carry `countryId` so that
 * `applyEra1991Adjustments` can resolve `getRegionPopulationAnchor(countryId, …)`.
 * Without it the anchor lookup misses and medianAge falls back to the generic
 * −5 blanket shift (bug: Dublin 1991 was 33.6 instead of the authored 29).
 */
type AnchorMap = Record<string, { medianAge: number; birthRate: number }>;
const CASES: Array<[string, typeof ieStateMetrics, AnchorMap, string]> = [
  ["IE", ieStateMetrics, iePopulationAnchors1991, "DUB"],
  ["JP", jpStateMetrics, jpPopulationAnchors1991, "KAN"],
  ["BR", brStateMetrics, brPopulationAnchors1991, "SUDESTE"],
  ["CN", cnStateMetrics, cnPopulationAnchors1991, "HD"],
  ["UK", ukStateMetrics, ukPopulationAnchors1991, "LON"],
];

describe("1991 population anchors activate (countryId present on seed metrics)", () => {
  for (const [country, metrics, anchors, region] of CASES) {
    it(`${country}: seed metrics carry countryId="${country}"`, () => {
      for (const m of metrics) {
        expect((m as { countryId?: string }).countryId, `${country} ${String(m._id)}`).toBe(
          country
        );
      }
    });

    it(`${country}: applyEra1991Adjustments uses the authored anchor for ${region}`, () => {
      const seed = metrics.find((m) => String(m._id) === region)!;
      const adjusted = applyEra1991Adjustments(seed);
      expect(adjusted.population?.medianAge?.value).toBe(anchors[region].medianAge);
      expect(adjusted.population?.birthRate?.value).toBe(anchors[region].birthRate);
    });
  }
});
