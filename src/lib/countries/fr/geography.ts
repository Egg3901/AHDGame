import type { CountryGeography } from "../contract";
import { frMetricPresets1953 } from "./data/frMetricPresets1953";
import { frRegionCensusData1953 } from "./data/frRegionCensusData1953";
import { frRegionCensusData1979 } from "./data/frRegionCensusData1979";
import { frRegions } from "./data/frRegions";
import { frRegions1953 } from "./data/frRegions1953";
import { frStateMetrics } from "./data/frStateMetrics";
import {
  FR_ADJACENCY_MAP,
  FR_INCOME_ANCHORS,
  FR_CONTINENT,
  FR_ISO_NUMERIC,
  FR_MAP_REGISTRY,
  FR_NPP_CAPITAL_STATE,
  FR_UN_MEMBER_SINCE,
  FR_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where France is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. France authors 2 census
 * eras, 1 metric eras, 0 anchor eras and 3 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  frRegions.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": frRegionCensusData1953,
  "1979-default": frRegionCensusData1979,
};

const metricPresetBundles = {
  "1953-default": frMetricPresets1953,
};

const populationAnchors = {};

const regionBundles = {
  "1953-default": frRegions1953,
  "1979-default": frRegions,
  "2019-default": frRegions,
};

export const FR_GEOGRAPHY: CountryGeography = {
  continent: FR_CONTINENT,

  isoNumeric: FR_ISO_NUMERIC,
  unMemberSince: FR_UN_MEMBER_SINCE,
  worldRegion: FR_WORLD_REGION,
  nppCapitalState: FR_NPP_CAPITAL_STATE,
  adjacency: FR_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: frStateMetrics,
  mapRegistry: FR_MAP_REGISTRY,
  incomeAnchors: FR_INCOME_ANCHORS,
};
