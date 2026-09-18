import type { CountryId } from "@/lib/constants/countries";
import type { Layer1Config } from "@/lib/seeds/stateDemographics";
import type { ResetPresetId } from "@/lib/seeds/presetSelector";
import { selectPresetBundleOptional } from "@/lib/seeds/presetSelector";
import { deRegionCensusData } from "@/lib/seeds/de/deRegionCensusData";
import { deRegionCensusData1953 } from "@/lib/seeds/de/deRegionCensusData1953";
import { deRegionCensusData1991 } from "@/lib/seeds/de/deRegionCensusData1991";
import { deRegionCensusData2027 } from "@/lib/seeds/de/deRegionCensusData2027";
import { ieRegionCensusData } from "@/lib/seeds/ie/ieRegionCensusData";
import { ieRegionCensusData1953 } from "@/lib/seeds/ie/ieRegionCensusData1953";
import { ieRegionCensusData1991 } from "@/lib/seeds/ie/ieRegionCensusData1991";
import { cnRegionCensusData } from "@/lib/seeds/cn/cnRegionCensusData";
import { cnRegionCensusData1953 } from "@/lib/seeds/cn/cnRegionCensusData1953";
import { cnRegionCensusData1991 } from "@/lib/seeds/cn/cnRegionCensusData1991";
import { cnRegionCensusData2027 } from "@/lib/seeds/cn/cnRegionCensusData2027";
import { brRegionCensusData } from "@/lib/seeds/br/brRegionCensusData";
import { brRegionCensusData1953 } from "@/lib/seeds/br/brRegionCensusData1953";
import { brRegionCensusData1991 } from "@/lib/seeds/br/brRegionCensusData1991";
import { seRegionCensusData } from "@/lib/seeds/se/seRegionCensusData";
import { seRegionCensusData1953 } from "@/lib/seeds/se/seRegionCensusData1953";
import { trRegionCensusData } from "@/lib/seeds/tr/trRegionCensusData";
import { trRegionCensusData1953 } from "@/lib/seeds/tr/trRegionCensusData1953";
import { frRegionCensusData1953 } from "@/lib/seeds/fr/frRegionCensusData1953";
import { itRegionCensusData1953 } from "@/lib/seeds/it/itRegionCensusData1953";
import { esRegionCensusData1953 } from "@/lib/seeds/es/esRegionCensusData1953";
import { ruRegionCensusData1953 } from "@/lib/seeds/ru/ruRegionCensusData1953";
import { ddRegionCensusData1953 } from "@/lib/seeds/dd/ddRegionCensusData1953";
import { ngRegionCensusData1953 } from "@/lib/seeds/ng/ngRegionCensusData1953";
// 1979-era census bundles (authored for the 1979 reset).
import { deRegionCensusData1979 } from "@/lib/seeds/de/deRegionCensusData1979";
import { ieRegionCensusData1979 } from "@/lib/seeds/ie/ieRegionCensusData1979";
import { cnRegionCensusData1979 } from "@/lib/seeds/cn/cnRegionCensusData1979";
import { brRegionCensusData1979 } from "@/lib/seeds/br/brRegionCensusData1979";
import { frRegionCensusData1979 } from "@/lib/seeds/fr/frRegionCensusData1979";
import { ngRegionCensusData1979 } from "@/lib/seeds/ng/ngRegionCensusData1979";
import { ngRegionCensusData } from "@/lib/seeds/ng/ngRegionCensusData";
import { scoRegionCensusData, scoRegionCensusData1991 } from "@/lib/seeds/sco/scoRegionCensusData";
import { walRegionCensusData, walRegionCensusData1991 } from "@/lib/seeds/wal/walRegionCensusData";

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
import { plRegionCensusData1953 } from "@/lib/seeds/pl/plRegionCensusData1953";
import { csRegionCensusData1953 } from "@/lib/seeds/cs/csRegionCensusData1953";
import { huRegionCensusData1953 } from "@/lib/seeds/hu/huRegionCensusData1953";
import { roRegionCensusData1953 } from "@/lib/seeds/ro/roRegionCensusData1953";
import { bgRegionCensusData1953 } from "@/lib/seeds/bg/bgRegionCensusData1953";
import { yuRegionCensusData1953 } from "@/lib/seeds/yu/yuRegionCensusData1953";
import { uaRegionCensusData1953 } from "@/lib/seeds/ua/uaRegionCensusData1953";
import { uaRegionCensusData } from "@/lib/seeds/ua/uaRegionCensusData";
import { blrRegionCensusData1953 } from "@/lib/seeds/blr/blrRegionCensusData1953";
import { blrRegionCensusData } from "@/lib/seeds/blr/blrRegionCensusData";
import { balRegionCensusData1953 } from "@/lib/seeds/bal/balRegionCensusData1953";
import { balRegionCensusData } from "@/lib/seeds/bal/balRegionCensusData";
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

export const CENSUS_BUNDLES: Partial<Record<CountryId, PresetBundles>> = {
  PL: {
    // Authored 1953 census existed but was never registered here, so
    // getRegionCensusData returned null and seedCohortVectors silently skipped
    // every PL region — no age pyramid at all for a demographic run.
    "1953-default": plRegionCensusData1953,
  },
  CS: {
    // Authored 1953 census existed but was never registered here, so
    // getRegionCensusData returned null and seedCohortVectors silently skipped
    // every CS region — no age pyramid at all for a demographic run.
    "1953-default": csRegionCensusData1953,
  },
  HU: {
    // Authored 1953 census existed but was never registered here, so
    // getRegionCensusData returned null and seedCohortVectors silently skipped
    // every HU region — no age pyramid at all for a demographic run.
    "1953-default": huRegionCensusData1953,
  },
  RO: {
    // Authored 1953 census existed but was never registered here, so
    // getRegionCensusData returned null and seedCohortVectors silently skipped
    // every RO region — no age pyramid at all for a demographic run.
    "1953-default": roRegionCensusData1953,
  },
  BG: {
    // Authored 1953 census existed but was never registered here, so
    // getRegionCensusData returned null and seedCohortVectors silently skipped
    // every BG region — no age pyramid at all for a demographic run.
    "1953-default": bgRegionCensusData1953,
  },
  YU: {
    // Authored 1953 census existed but was never registered here, so
    // getRegionCensusData returned null and seedCohortVectors silently skipped
    // every YU region — no age pyramid at all for a demographic run.
    "1953-default": yuRegionCensusData1953,
  },
  // Soviet union republics promoted to their own countries. Unlike the
  // satellites above these carry BOTH Cold-War eras: the 1959 and 1979 all-Union
  // censuses are the best-documented demographic series in the bloc, and the
  // ethnic movement between them (Russification, in-migration to the Baltic
  // cities, the west of Ukraine staying Ukrainian) is a mechanic here rather
  // than flavour, so an era proxy would flatten the thing being modelled.
  UKR: {
    "1953-default": uaRegionCensusData1953,
    "1979-default": uaRegionCensusData,
  },
  BLR: {
    "1953-default": blrRegionCensusData1953,
    "1979-default": blrRegionCensusData,
  },
  BAL: {
    "1953-default": balRegionCensusData1953,
    "1979-default": balRegionCensusData,
  },

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
  SCO: { "2019-default": scoRegionCensusData, "1991-default": scoRegionCensusData1991 },
  WAL: { "2019-default": walRegionCensusData, "1991-default": walRegionCensusData1991 },
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
