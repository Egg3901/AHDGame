import type { CountryId } from "@/lib/constants/countries";
import type { Layer1Config } from "@/lib/seeds/stateDemographics";
import type { ResetPresetId } from "@/lib/seeds/presetSelector";
import { selectPresetBundleOptional } from "@/lib/seeds/presetSelector";
// 1979-era census bundles (authored for the 1979 reset).

/** Archetype-style Layer-1 census (UK/JP/DE/IE/CN/BR). */
export interface ArchetypeRegionCensus {
  ethnicity: Record<string, number>;
  age: Record<string, number>;
  education: Record<string, number>;
  income: Record<string, number>;
  urbanization: Record<string, number>;
}

export type RegionCensus = Layer1Config | ArchetypeRegionCensus;

type PresetBundles = Partial<Record<ResetPresetId, Record<string, RegionCensus>>>;

/**
 * Per-country census bundles keyed by preset. New eras/countries register here.
 * `selectPresetBundle` falls back to `2019-default` when a preset is absent,
 * so a country with only a 2019 bundle never throws for a 1991 world.
 */
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { JP_GEOGRAPHY } from "@/lib/countries/jp/geography";
import { US_GEOGRAPHY } from "@/lib/countries/us/geography";
import { UK_GEOGRAPHY } from "@/lib/countries/uk/geography";
import { DE_GEOGRAPHY } from "@/lib/countries/de/geography";
import { CN_GEOGRAPHY } from "@/lib/countries/cn/geography";
import { IE_GEOGRAPHY } from "@/lib/countries/ie/geography";
import { RU_GEOGRAPHY } from "@/lib/countries/ru/geography";
import { DD_GEOGRAPHY } from "@/lib/countries/dd/geography";
import { NG_GEOGRAPHY } from "@/lib/countries/ng/geography";
import { BR_GEOGRAPHY } from "@/lib/countries/br/geography";
import { FR_GEOGRAPHY } from "@/lib/countries/fr/geography";
import { IT_GEOGRAPHY } from "@/lib/countries/it/geography";
import { ES_GEOGRAPHY } from "@/lib/countries/es/geography";
import { SE_GEOGRAPHY } from "@/lib/countries/se/geography";
import { TR_GEOGRAPHY } from "@/lib/countries/tr/geography";
import { PL_GEOGRAPHY } from "@/lib/countries/pl/geography";
import { HU_GEOGRAPHY } from "@/lib/countries/hu/geography";
import { RO_GEOGRAPHY } from "@/lib/countries/ro/geography";
import { YU_GEOGRAPHY } from "@/lib/countries/yu/geography";
import { BG_GEOGRAPHY } from "@/lib/countries/bg/geography";
import { CS_GEOGRAPHY } from "@/lib/countries/cs/geography";
import { SCO_GEOGRAPHY } from "@/lib/countries/sco/geography";
import { WAL_GEOGRAPHY } from "@/lib/countries/wal/geography";
import { BLR_GEOGRAPHY } from "@/lib/countries/blr/geography";
import { UKR_GEOGRAPHY } from "@/lib/countries/ukr/geography";
import { BAL_GEOGRAPHY } from "@/lib/countries/bal/geography";

export const CENSUS_BUNDLES: Partial<Record<CountryId, PresetBundles>> = {
  PL: PL_GEOGRAPHY.censusBundles,
  CS: CS_GEOGRAPHY.censusBundles,
  HU: HU_GEOGRAPHY.censusBundles,
  RO: RO_GEOGRAPHY.censusBundles,
  BG: BG_GEOGRAPHY.censusBundles,
  YU: YU_GEOGRAPHY.censusBundles,
  // Soviet union republics promoted to their own countries. Unlike the
  // satellites above these carry BOTH Cold-War eras: the 1959 and 1979 all-Union
  // censuses are the best-documented demographic series in the bloc, and the
  // ethnic movement between them (Russification, in-migration to the Baltic
  // cities, the west of Ukraine staying Ukrainian) is a mechanic here rather
  // than flavour, so an era proxy would flatten the thing being modelled.
  UKR: UKR_GEOGRAPHY.censusBundles,
  BLR: BLR_GEOGRAPHY.censusBundles,
  BAL: BAL_GEOGRAPHY.censusBundles,

  US: US_GEOGRAPHY.censusBundles,
  UK: UK_GEOGRAPHY.censusBundles,
  JP: JP_GEOGRAPHY.censusBundles,
  DE: DE_GEOGRAPHY.censusBundles,
  IE: IE_GEOGRAPHY.censusBundles,
  CN: CN_GEOGRAPHY.censusBundles,
  BR: BR_GEOGRAPHY.censusBundles,
  SE: SE_GEOGRAPHY.censusBundles,
  TR: TR_GEOGRAPHY.censusBundles,
  FR: FR_GEOGRAPHY.censusBundles,
  // IT/ES/SU/DD have no authored 1979 census yet; route 1979 to the 1953 bundle as the
  // nearest-era proxy. Without an explicit 1979 entry selectPresetBundle would throw for
  // these (no 2019-default fallback exists), aborting the 1979 reset in seedCohortVectors.
  IT: IT_GEOGRAPHY.censusBundles,
  ES: ES_GEOGRAPHY.censusBundles,
  RU: RU_GEOGRAPHY.censusBundles,
  DD: DD_GEOGRAPHY.censusBundles,
  // 2019-default was missing here even though ngRegionCensusData (the NPC/NBS-based
  // 2019 bundle already used by seeds/international/ng.ts) has existed since NG
  // launched — any full bootstrap/reset to the default preset crashed in
  // seedCohortVectors for every NG state. Wiring gap, not missing data.
  NG: NG_GEOGRAPHY.censusBundles,
  // Seceded nations carry their own per-sub-region census (differentiated from
  // the former UK Scotland/Wales aggregate).
  SCO: SCO_GEOGRAPHY.censusBundles,
  WAL: WAL_GEOGRAPHY.censusBundles,
};

/**
 * Preset-aware Layer-1 census lookup for a region. Returns the per-state record
 * or null (no bundle for the country, or no entry for the state).
 */
export function getRegionCensusData(
  countryId: CountryId,
  stateId: string,
  preset: string | undefined
): RegionCensus | null {
  const byPreset = CENSUS_BUNDLES[countryId];
  if (!byPreset) return null;
  // Deliberately NOT selectPresetBundle: that helper throws when neither the
  // exact preset nor a "2019-default" fallback exists, which is correct for
  // required seed data but wrong here — this function's contract (see doc
  // comment above) is to return null for "no bundle for the country" so
  // callers can skip cleanly: seedCohortVectors skips the state and logs why;
  // the region-page render path degrades to null instead of crashing. Several
  // countries (FR/IT/ES/RU/DD, as of 2026-06) only have 1953/1979 bundles
  // authored — those should skip cleanly under 2019-default, not abort.
  const bundle = selectPresetBundleOptional(preset ?? DEFAULT_SEED_PRESET, byPreset);
  return bundle?.[stateId] ?? null;
}
