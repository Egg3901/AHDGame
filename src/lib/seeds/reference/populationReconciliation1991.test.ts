import { describe, expect, it } from "vitest";
import { CN_GEOGRAPHY } from "@/lib/countries/cn/geography";
import { NG_GEOGRAPHY } from "@/lib/countries/ng/geography";
import { FR_GEOGRAPHY } from "@/lib/countries/fr/geography";
import { ES_GEOGRAPHY } from "@/lib/countries/es/geography";
import { SE_GEOGRAPHY } from "@/lib/countries/se/geography";
import { TR_GEOGRAPHY } from "@/lib/countries/tr/geography";
import { getNationalBudgetSeedConfigsForPreset } from "./budgets";
import { selectPresetBundle } from "../presetSelector";

const bundles = {
  CN: CN_GEOGRAPHY.regionBundles,
  NG: NG_GEOGRAPHY.regionBundles,
  FR: FR_GEOGRAPHY.regionBundles,
  ES: ES_GEOGRAPHY.regionBundles,
  SE: SE_GEOGRAPHY.regionBundles,
  TR: TR_GEOGRAPHY.regionBundles,
};
const countries = ["CN", "NG", "FR", "ES", "SE", "TR"] as const;
describe("1991 country population reconciliation", () => {
  it.each(countries)("reconciles %s regions with its national population", (country) => {
    const bundle = selectPresetBundle(
      "1991-default",
      bundles[country],
      "population-reconciliation"
    );
    const total = bundle.reduce((sum, region) => sum + region.population, 0);
    const national = getNationalBudgetSeedConfigsForPreset("1991-default").find(
      (config) => config.countryId === country
    );
    expect(total).toBe(national?.population);
  });
});
