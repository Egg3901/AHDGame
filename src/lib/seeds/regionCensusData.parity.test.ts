import { describe, it, expect } from "vitest";
import { getRegionCensusData, type ArchetypeRegionCensus } from "./regionCensusData";
import { REGION_CENSUS_LABELS } from "@/lib/constants/regionCensusLabels";
import type { CountryId } from "@/lib/constants/countries";

/** One known region per playable country. */
const SAMPLES: Record<string, string> = {
  US: "CA",
  UK: "LON",
  JP: "KAN",
  DE: "BY",
  IE: "DUB",
  CN: "HD",
  BR: "SUDESTE",
};

const ARCHETYPE_COUNTRIES = ["UK", "JP", "DE", "IE", "CN", "BR"] as const;

describe("region census cross-preset parity", () => {
  for (const [cc, region] of Object.entries(SAMPLES)) {
    for (const preset of ["1991-default", "2019-default"]) {
      it(`${cc} ${region} resolves census under ${preset}`, () => {
        expect(getRegionCensusData(cc as CountryId, region, preset)).not.toBeNull();
      });
    }
  }

  it("archetype census keys are fully covered by the label sets (no raw-key leakage)", () => {
    for (const cc of ARCHETYPE_COUNTRIES) {
      const labels = REGION_CENSUS_LABELS[cc as CountryId]!;
      for (const preset of ["1991-default", "2019-default"]) {
        const census = getRegionCensusData(
          cc as CountryId,
          SAMPLES[cc],
          preset
        ) as ArchetypeRegionCensus;
        for (const dim of ["ethnicity", "age", "education", "income", "urbanization"] as const) {
          for (const key of Object.keys(census[dim])) {
            expect(labels[dim][key], `${cc} ${preset} ${dim} label for "${key}"`).toBeTruthy();
          }
        }
      }
    }
  });

  it("NG (not playable) resolves to null under both presets", () => {
    expect(getRegionCensusData("NG" as CountryId, "LA", "1991-default")).toBeNull();
    expect(getRegionCensusData("NG" as CountryId, "LA", "2019-default")).toBeNull();
  });
});
