import type { CountryId } from "@/lib/constants/countries";
import { selectPresetBundleOptional } from "@/lib/seeds/presetSelector";
import type { ResetPresetId } from "@/lib/seeds/presetSelector";
import {
  iePopulationAnchors2019,
  iePopulationAnchors1991,
  type PopulationAnchor,
} from "@/lib/seeds/ie/iePopulationAnchors";
import {
  dePopulationAnchors2019,
  dePopulationAnchors1991,
} from "@/lib/seeds/de/dePopulationAnchors";
import {
  jpPopulationAnchors2019,
  jpPopulationAnchors1991,
} from "@/lib/seeds/jp/jpPopulationAnchors";
import {
  brPopulationAnchors2019,
  brPopulationAnchors1991,
} from "@/lib/seeds/br/brPopulationAnchors";
import {
  cnPopulationAnchors2019,
  cnPopulationAnchors1991,
} from "@/lib/seeds/cn/cnPopulationAnchors";
import {
  ukPopulationAnchors2019,
  ukPopulationAnchors1991,
} from "@/lib/seeds/uk/ukPopulationAnchors";
import {
  usPopulationAnchors2019,
  usPopulationAnchors1991,
} from "@/lib/seeds/reference/usPopulationAnchors";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

export type { PopulationAnchor };
type AnchorBundle = Record<string, PopulationAnchor>;
type PresetBundles = Partial<Record<ResetPresetId, AnchorBundle>>;

/**
 * Country → preset → { regionId → { medianAge, birthRate } } pyramid drivers. New
 * countries/eras register here. Mirrors `CENSUS_BUNDLES` in regionCensusData.ts;
 * `selectPresetBundle` falls back to `2019-default` so a country with only a 2019
 * bundle never throws for a 1991 world.
 */
const POPULATION_ANCHOR_BUNDLES: Partial<Record<CountryId, PresetBundles>> = {
  IE: { "2019-default": iePopulationAnchors2019, "1991-default": iePopulationAnchors1991 },
  DE: { "2019-default": dePopulationAnchors2019, "1991-default": dePopulationAnchors1991 },
  JP: { "2019-default": jpPopulationAnchors2019, "1991-default": jpPopulationAnchors1991 },
  BR: { "2019-default": brPopulationAnchors2019, "1991-default": brPopulationAnchors1991 },
  CN: { "2019-default": cnPopulationAnchors2019, "1991-default": cnPopulationAnchors1991 },
  UK: { "2019-default": ukPopulationAnchors2019, "1991-default": ukPopulationAnchors1991 },
  US: { "2019-default": usPopulationAnchors2019, "1991-default": usPopulationAnchors1991 },
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
