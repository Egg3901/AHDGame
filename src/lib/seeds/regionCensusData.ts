import type { CountryId } from "@/lib/constants/countries";
import type { Layer1Config } from "@/lib/seeds/stateDemographics";
import type { ResetPresetId } from "@/lib/seeds/presetSelector";
import { selectPresetBundleOptional } from "@/lib/seeds/presetSelector";
import { stateCensusData } from "@/lib/seeds/stateDemographics";
import { stateCensusData1953 } from "@/lib/seeds/stateCensusData1953";
import { stateCensusData1979 } from "@/lib/seeds/stateCensusData1979";
import { stateCensusData1991 } from "@/lib/seeds/stateCensusData1991";
import { stateCensusData1999 } from "@/lib/seeds/stateCensusData1999";
import { stateCensusData2007 } from "@/lib/seeds/stateCensusData2007";
import { stateCensusData2023 } from "@/lib/seeds/stateCensusData2023";
import { ukRegionCensusData } from "@/lib/seeds/uk/ukRegionCensusData";
import { ukRegionCensusData1953 } from "@/lib/seeds/uk/ukRegionCensusData1953";
import { ukRegionCensusData1991 } from "@/lib/seeds/uk/ukRegionCensusData1991";
import { jpRegionCensusData } from "@/lib/seeds/jp/jpRegionCensusData";
import { jpRegionCensusData1953 } from "@/lib/seeds/jp/jpRegionCensusData1953";
import { jpRegionCensusData1991 } from "@/lib/seeds/jp/jpRegionCensusData1991";
import { deRegionCensusData } from "@/lib/seeds/de/deRegionCensusData";
import { deRegionCensusData1953 } from "@/lib/seeds/de/deRegionCensusData1953";
import { deRegionCensusData1991 } from "@/lib/seeds/de/deRegionCensusData1991";
import { ieRegionCensusData } from "@/lib/seeds/ie/ieRegionCensusData";
import { ieRegionCensusData1953 } from "@/lib/seeds/ie/ieRegionCensusData1953";
import { ieRegionCensusData1991 } from "@/lib/seeds/ie/ieRegionCensusData1991";
import { cnRegionCensusData } from "@/lib/seeds/cn/cnRegionCensusData";
import { cnRegionCensusData1953 } from "@/lib/seeds/cn/cnRegionCensusData1953";
import { cnRegionCensusData1991 } from "@/lib/seeds/cn/cnRegionCensusData1991";
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
import { ukRegionCensusData1979 } from "@/lib/seeds/uk/ukRegionCensusData1979";
import { jpRegionCensusData1979 } from "@/lib/seeds/jp/jpRegionCensusData1979";
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

const CENSUS_BUNDLES: Partial<Record<CountryId, PresetBundles>> = {
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

  US: {
    "1953-default": stateCensusData1953, // 1979 shares proxy, 1979-authored positions stripped
    "1979-default": stateCensusData1979,
    "1991-default": stateCensusData1991,
    "1999-default": stateCensusData1999,
    "2007-default": stateCensusData2007,
    "2019-default": stateCensusData,
    "2023-default": stateCensusData2023,
  },
  UK: {
    "1953-default": ukRegionCensusData1953,
    "1979-default": ukRegionCensusData1979,
    "2019-default": ukRegionCensusData,
    "1991-default": ukRegionCensusData1991,
  },
  JP: {
    "1953-default": jpRegionCensusData1953,
    "1979-default": jpRegionCensusData1979,
    "2019-default": jpRegionCensusData,
    "1991-default": jpRegionCensusData1991,
  },
  DE: {
    "1953-default": deRegionCensusData1953,
    "1979-default": deRegionCensusData1979,
    "2019-default": deRegionCensusData,
    "1991-default": deRegionCensusData1991,
  },
  IE: {
    "1953-default": ieRegionCensusData1953,
    "1979-default": ieRegionCensusData1979,
    "2019-default": ieRegionCensusData,
    "1991-default": ieRegionCensusData1991,
  },
  CN: {
    "1953-default": cnRegionCensusData1953,
    "1979-default": cnRegionCensusData1979,
    "2019-default": cnRegionCensusData,
    "1991-default": cnRegionCensusData1991,
  },
  BR: {
    "1953-default": brRegionCensusData1953,
    "1979-default": brRegionCensusData1979,
    "2019-default": brRegionCensusData,
    "1991-default": brRegionCensusData1991,
  },
  SE: {
    "1953-default": seRegionCensusData1953,
    "1979-default": seRegionCensusData,
    "2019-default": seRegionCensusData,
  },
  TR: {
    "1953-default": trRegionCensusData1953,
    "1979-default": trRegionCensusData,
    "2019-default": trRegionCensusData,
  },
  FR: { "1953-default": frRegionCensusData1953, "1979-default": frRegionCensusData1979 },
  // IT/ES/SU/DD have no authored 1979 census yet; route 1979 to the 1953 bundle as the
  // nearest-era proxy. Without an explicit 1979 entry selectPresetBundle would throw for
  // these (no 2019-default fallback exists), aborting the 1979 reset in seedCohortVectors.
  IT: { "1953-default": itRegionCensusData1953, "1979-default": itRegionCensusData1953 },
  ES: { "1953-default": esRegionCensusData1953, "1979-default": esRegionCensusData1953 },
  RU: { "1953-default": ruRegionCensusData1953, "1979-default": ruRegionCensusData1953 },
  DD: { "1953-default": ddRegionCensusData1953, "1979-default": ddRegionCensusData1953 },
  // 2019-default was missing here even though ngRegionCensusData (the NPC/NBS-based
  // 2019 bundle already used by seeds/international/ng.ts) has existed since NG
  // launched — any full bootstrap/reset to the default preset crashed in
  // seedCohortVectors for every NG state. Wiring gap, not missing data.
  NG: {
    "1953-default": ngRegionCensusData1953,
    "1979-default": ngRegionCensusData1979,
    // 1991-default was missing → seedCohortVectors skipped every NG state in a 1991
    // world (no cohort vectors, so NG demographic metrics never computed). Alias to the
    // 1979 census — the closest authored, era-appropriate for a 1991 world (NG's age
    // structure is persistently young); NOT the 2019 bundle (would be a modern fallback).
    "1991-default": ngRegionCensusData1979,
    "2019-default": ngRegionCensusData,
  },
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
