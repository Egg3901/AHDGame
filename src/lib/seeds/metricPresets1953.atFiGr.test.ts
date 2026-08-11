/**
 * AT/FI/GR 1953 metric-preset coverage — every census region must resolve a
 * non-null overlay, life expectancy must sit in the era band [40, 72], and
 * broadband must be zero (no 2019 tech leak).
 */
import { describe, expect, it } from "vitest";
import { getRegionMetricPresets } from "@/lib/seeds/metricPresets";
import { atRegionCensusData1953 } from "@/lib/seeds/at/atRegionCensusData1953";
import { fiRegionCensusData1953 } from "@/lib/seeds/fi/fiRegionCensusData1953";
import { grRegionCensusData1953 } from "@/lib/seeds/gr/grRegionCensusData1953";
import type { CountryId } from "@/lib/constants/countries";

const TECH_ZERO_PATHS = [
  "infrastructure.broadbandAccess",
  "infrastructure.internetAccess",
  "infrastructure.digitalInfrastructure",
] as const;

const COUNTRY_CENSUS: Array<{
  country: CountryId;
  census: Record<string, unknown>;
}> = [
  { country: "AT", census: atRegionCensusData1953 },
  { country: "FI", census: fiRegionCensusData1953 },
  { country: "GR", census: grRegionCensusData1953 },
];

describe("AT/FI/GR 1953 metric presets — full census coverage", () => {
  for (const { country, census } of COUNTRY_CENSUS) {
    const regionIds = Object.keys(census);

    it(`${country}: every 1953 census region has a non-null overlay`, () => {
      expect(regionIds.length).toBeGreaterThan(0);
      for (const regionId of regionIds) {
        const overlay = getRegionMetricPresets(country, regionId, "1953-default");
        expect(overlay, `${country}/${regionId}`).toBeTruthy();
      }
    });

    it(`${country}: life expectancy in [40, 72] and broadband/internet ≤ 0`, () => {
      for (const regionId of regionIds) {
        const overlay = getRegionMetricPresets(country, regionId, "1953-default")!;
        const life = overlay["healthcare.lifeExpectancy"];
        expect(life, `${country}/${regionId} lifeExpectancy`).toBeTypeOf("number");
        expect(life).toBeGreaterThanOrEqual(40);
        expect(life).toBeLessThanOrEqual(72);

        for (const path of TECH_ZERO_PATHS) {
          if (overlay[path] !== undefined) {
            expect(overlay[path], `${country}/${regionId} ${path}`).toBeLessThanOrEqual(0);
          }
        }
        expect(overlay["infrastructure.broadbandAccess"]).toBe(0);
      }
    });
  }
});
