import type { CountryId } from "@/lib/constants/countries";
import { selectPresetBundleOptional } from "@/lib/seeds/presetSelector";
import type { ResetPresetId } from "@/lib/seeds/presetSelector";
import { type PopulationAnchor } from "@/lib/seeds/ie/iePopulationAnchors";
import {} from "@/lib/countries/jp/data/jpPopulationAnchors";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { JP_GEOGRAPHY } from "@/lib/countries/jp/geography";
import { US_GEOGRAPHY } from "@/lib/countries/us/geography";
import { UK_GEOGRAPHY } from "@/lib/countries/uk/geography";
import { DE_GEOGRAPHY } from "@/lib/countries/de/geography";
import { CN_GEOGRAPHY } from "@/lib/countries/cn/geography";
import { IE_GEOGRAPHY } from "@/lib/countries/ie/geography";
import { BR_GEOGRAPHY } from "@/lib/countries/br/geography";

export type { PopulationAnchor };
export type AnchorBundle = Record<string, PopulationAnchor>;
type PresetBundles = Partial<Record<ResetPresetId, AnchorBundle>>;

/**
 * Country → preset → { regionId → { medianAge, birthRate } } pyramid drivers. New
 * countries/eras register here. Mirrors `CENSUS_BUNDLES` in regionCensusData.ts;
 * `selectPresetBundle` falls back to `2019-default` so a country with only a 2019
 * bundle never throws for a 1991 world.
 */
export const POPULATION_ANCHOR_BUNDLES: Partial<Record<CountryId, PresetBundles>> = {
  IE: IE_GEOGRAPHY.populationAnchors,
  DE: DE_GEOGRAPHY.populationAnchors,
  JP: JP_GEOGRAPHY.populationAnchors,
  BR: BR_GEOGRAPHY.populationAnchors,
  CN: CN_GEOGRAPHY.populationAnchors,
  UK: UK_GEOGRAPHY.populationAnchors,
  US: US_GEOGRAPHY.populationAnchors,
};

/**
 * Per-region era anchor (medianAge + birthRate). Falls back to the 2019 bundle when a
 * preset is absent; null when the country has no bundle or the region has no entry.
 */
export function getRegionPopulationAnchor(
  countryId: CountryId,
  regionId: string,
  preset: string | undefined
): PopulationAnchor | null {
  const byPreset = POPULATION_ANCHOR_BUNDLES[countryId];
  if (!byPreset) return null;
  const bundle = selectPresetBundleOptional(preset ?? DEFAULT_SEED_PRESET, byPreset);
  return bundle?.[regionId] ?? null;
}
