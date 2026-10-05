import { describe, expect, it } from "vitest";
import { baselineFor } from "./baselineAnchors";
import { NATIONAL_BASELINES_1979 } from "./nationalBaselines1979";
import { NATIONAL_BASELINES_1991 } from "./nationalBaselines1991";
import { baselineLevelFor, getCatalog } from "@/lib/politicalLegislation/catalog";
import { BASELINE_LEVEL_OVERRIDES_1991 } from "@/lib/politicalLegislation/seeds/baselineLevels1991";
import { POLITICAL_METRIC_COUNTRY_IDS, type PoliticalMetricId } from "../types";

// Presets after 1991 have no authored board. They must keep the values they
// seeded before the 1991 anchor existed, not clamp to the 1991 opening.
const LATER_PRESET_YEARS = [1999, 2007, 2019, 2023, 2027];

describe("political baselines after the 1991 opening", () => {
  for (const countryId of POLITICAL_METRIC_COUNTRY_IDS) {
    it(`${countryId} later presets seed the pre-1991 board`, () => {
      for (const id of Object.keys(NATIONAL_BASELINES_1979[countryId]) as PoliticalMetricId[]) {
        for (const year of LATER_PRESET_YEARS) {
          expect(baselineFor(countryId, id, year)).toBe(NATIONAL_BASELINES_1979[countryId][id]);
        }
        expect(baselineFor(countryId, id, 1991)).toBe(NATIONAL_BASELINES_1991[countryId][id]);
      }
    });

    it(`${countryId} later presets seed laws at their pre-1991 level`, () => {
      for (const law of getCatalog(countryId)) {
        if (law.kind === "tax") continue;
        const inherited = law.baselineLevel ?? 0;
        for (const year of LATER_PRESET_YEARS) {
          expect(baselineLevelFor(law, year)).toBe(inherited);
        }
        expect(baselineLevelFor(law, 1991)).toBe(
          BASELINE_LEVEL_OVERRIDES_1991[law.id] ?? inherited
        );
      }
    });
  }
});
