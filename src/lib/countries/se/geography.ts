import type { CountryGeography } from "../contract";
import { seMetricPresets1953 } from "./data/seMetricPresets1953";
import { seRegionCensusData } from "@/lib/seeds/se/seRegionCensusData";
import { seRegionCensusData1953 } from "@/lib/seeds/se/seRegionCensusData1953";
import { seRegions } from "./data/seRegions";
import { seRegions1953 } from "./data/seRegions1953";
import { seStateMetrics } from "./data/seStateMetrics";
import {
  SE_ADJACENCY_MAP,
  SE_INCOME_ANCHORS,
  SE_CONTINENT,
  SE_ISO_NUMERIC,
  SE_MAP_REGISTRY,
  SE_NPP_CAPITAL_STATE,
  SE_UN_MEMBER_SINCE,
  SE_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Sweden is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Sweden authors 3 census
 * eras, 1 metric eras, 0 anchor eras and 3 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  seRegions.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": seRegionCensusData1953,
  "1979-default": seRegionCensusData,
  "2019-default": seRegionCensusData,
};

const metricPresetBundles = {
  "1953-default": seMetricPresets1953,
};

const populationAnchors = {};

const regionBundles = {
  "1953-default": seRegions1953,
  "1979-default": seRegions,
  "2019-default": seRegions,
};

export const SE_GEOGRAPHY: CountryGeography = {
  continent: SE_CONTINENT,

  isoNumeric: SE_ISO_NUMERIC,
  unMemberSince: SE_UN_MEMBER_SINCE,
  worldRegion: SE_WORLD_REGION,
  nppCapitalState: SE_NPP_CAPITAL_STATE,
  adjacency: SE_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: seStateMetrics,
  mapRegistry: SE_MAP_REGISTRY,
  incomeAnchors: SE_INCOME_ANCHORS,
};
