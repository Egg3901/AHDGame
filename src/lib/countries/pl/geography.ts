import type { CountryGeography } from "../contract";
import { plRegionCensusData1953 } from "./data/plRegionCensusData1953";
import { plRegions } from "./data/plRegions";
import { plRegions1953 } from "./data/plRegions1953";
import {
  PL_ADJACENCY_MAP,
  PL_CONTINENT,
  PL_ISO_NUMERIC,
  PL_MAP_REGISTRY,
  PL_NPP_CAPITAL_STATE,
  PL_UN_MEMBER_SINCE,
  PL_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Poland is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Poland authors 1 census
 * eras, 0 metric eras, 0 anchor eras and 3 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  plRegions.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": plRegionCensusData1953,
};

const metricPresetBundles = {};

const populationAnchors = {};

const regionBundles = {
  "1953-default": plRegions1953,
  "1979-default": plRegions,
  "2019-default": plRegions,
};

export const PL_GEOGRAPHY: CountryGeography = {
  continent: PL_CONTINENT,

  isoNumeric: PL_ISO_NUMERIC,
  unMemberSince: PL_UN_MEMBER_SINCE,
  worldRegion: PL_WORLD_REGION,
  nppCapitalState: PL_NPP_CAPITAL_STATE,
  adjacency: PL_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: [],
  mapRegistry: PL_MAP_REGISTRY,
};
