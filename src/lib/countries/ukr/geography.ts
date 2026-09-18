import type { CountryGeography } from "../contract";
import { uaRegionCensusData } from "@/lib/seeds/ua/uaRegionCensusData";
import { uaRegionCensusData1953 } from "@/lib/seeds/ua/uaRegionCensusData1953";
import { uaRegions } from "./data/uaRegions";
import { uaRegions1953 } from "./data/uaRegions1953";
import {
  UKR_ADJACENCY_MAP,
  UKR_CONTINENT,
  UKR_ISO_NUMERIC,
  UKR_MAP_REGISTRY,
  UKR_NPP_CAPITAL_STATE,
  UKR_UN_MEMBER_SINCE,
  UKR_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Ukraine is, and who lives there.
 *
 * ⚠ HEAVY. Every era of census, metric and region data is imported as a VALUE. A
 * registry that needs one string imports `./geographyFacts` instead, which has
 * no value imports at all -- `countryContinents.ts` once held `JP: "Asia"` at
 * zero cost, was repointed at a heavy module, and began pulling 108 KB into
 * every client bundle that read a continent.
 *
 * ⚠ EVERY BUNDLE IS REFERENCED, NEVER INLINED, and `===` is what proves it. An
 * early revision of Japan's geography generated copies from the snapshot; deep
 * equality passed and Japan had two sources for every region.
 *
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Ukraine authors 2 census
 * eras, 0 metric eras, 0 anchor eras and 2 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  uaRegions.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": uaRegionCensusData1953,
  "1979-default": uaRegionCensusData,
};

const metricPresetBundles = {};

const populationAnchors = {};

const regionBundles = {
  "1953-default": uaRegions1953,
  "2019-default": uaRegions,
};

export const UKR_GEOGRAPHY: CountryGeography = {
  continent: UKR_CONTINENT,

  isoNumeric: UKR_ISO_NUMERIC,
  unMemberSince: UKR_UN_MEMBER_SINCE,
  worldRegion: UKR_WORLD_REGION,
  nppCapitalState: UKR_NPP_CAPITAL_STATE,
  adjacency: UKR_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: [],
  mapRegistry: UKR_MAP_REGISTRY,
};
