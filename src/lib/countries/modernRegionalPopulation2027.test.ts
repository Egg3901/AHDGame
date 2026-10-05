import { describe, expect, it } from "vitest";
import { AT_GEOGRAPHY } from "./at/geography";
import { CN_GEOGRAPHY } from "./cn/geography";
import { cnRegions2027 } from "./cn/data/cnRegions2027";
import { ES_GEOGRAPHY } from "./es/geography";
import { FI_GEOGRAPHY } from "./fi/geography";
import { FR_GEOGRAPHY } from "./fr/geography";
import { GR_GEOGRAPHY } from "./gr/geography";
import { IE_GEOGRAPHY } from "./ie/geography";
import { IT_GEOGRAPHY } from "./it/geography";
import { NG_GEOGRAPHY } from "./ng/geography";
import { SE_GEOGRAPHY } from "./se/geography";
import { MODERN_REGIONAL_POPULATION_ANCHORS_2027 } from "../seeds/reference/modernRegionalPopulation2027";
import { getNationalBudgetSeedConfigsForPreset } from "../seeds/reference/budgets";
import { selectPresetBundle } from "../seeds/presetSelector";

const MODERN_COUNTRIES = {
  IE: { geography: IE_GEOGRAPHY, shareSource: IE_GEOGRAPHY.regionBundles["2023-default"] },
  CN: { geography: CN_GEOGRAPHY, shareSource: cnRegions2027 },
  NG: { geography: NG_GEOGRAPHY, shareSource: NG_GEOGRAPHY.regionBundles["2023-default"] },
  FR: { geography: FR_GEOGRAPHY, shareSource: FR_GEOGRAPHY.regionBundles["2019-default"] },
  IT: { geography: IT_GEOGRAPHY, shareSource: IT_GEOGRAPHY.regionBundles["2019-default"] },
  ES: { geography: ES_GEOGRAPHY, shareSource: ES_GEOGRAPHY.regionBundles["2019-default"] },
  SE: { geography: SE_GEOGRAPHY, shareSource: SE_GEOGRAPHY.regionBundles["2019-default"] },
  GR: { geography: GR_GEOGRAPHY, shareSource: GR_GEOGRAPHY.regionBundles["2019-default"] },
  AT: { geography: AT_GEOGRAPHY, shareSource: AT_GEOGRAPHY.regionBundles["2019-default"] },
  FI: { geography: FI_GEOGRAPHY, shareSource: FI_GEOGRAPHY.regionBundles["2019-default"] },
} as const;

describe("modern 2027 regional population anchors", () => {
  const fiscalBudgets = getNationalBudgetSeedConfigsForPreset("2027-default");

  it("reconciles every issue #2325 regional sum to its fiscal budget anchor", () => {
    for (const [countryId, { geography, shareSource }] of Object.entries(MODERN_COUNTRIES)) {
      const normalized = geography.regionBundles["2027-default"];
      const budgetPopulation = fiscalBudgets.find((row) => row.countryId === countryId)?.population;
      expect(budgetPopulation, `${countryId} budget`).toBe(
        MODERN_REGIONAL_POPULATION_ANCHORS_2027[
          countryId as keyof typeof MODERN_REGIONAL_POPULATION_ANCHORS_2027
        ]
      );
      expect(normalized, `${countryId} modern bundle`).toBeDefined();
      expect(selectPresetBundle("2027-default", geography.regionBundles, `test:${countryId}`)).toBe(
        normalized
      );
      expect(normalized!.map((region) => region._id)).toEqual(
        shareSource!.map((region) => region._id)
      );
      expect(normalized!.reduce((sum, region) => sum + region.population, 0)).toBe(
        budgetPopulation
      );

      const shareTotal = shareSource!.reduce((sum, region) => sum + region.population, 0);
      normalized!.forEach((region, index) => {
        const exact = (shareSource![index].population / shareTotal) * budgetPopulation!;
        expect(
          Math.abs(region.population - exact),
          `${countryId}/${region._id} share`
        ).toBeLessThan(1.01);
      });
    }
  });
  it("keeps 2019 and authored 2023 preset selection unchanged", () => {
    for (const [countryId, { geography }] of Object.entries(MODERN_COUNTRIES)) {
      expect(selectPresetBundle("2019-default", geography.regionBundles, `test:${countryId}`)).toBe(
        geography.regionBundles["2019-default"]
      );
    }
    for (const geography of [IE_GEOGRAPHY, CN_GEOGRAPHY, NG_GEOGRAPHY]) {
      expect(selectPresetBundle("2023-default", geography.regionBundles, "test:2023")).toBe(
        geography.regionBundles["2023-default"]
      );
    }
  });
});
