import type { CountryGeography } from "../contract";
import { esMetricPresets1953 } from "./data/esMetricPresets1953";
import { esRegionCensusData } from "@/lib/seeds/es/esRegionCensusData";
import { esRegionCensusData1953 } from "@/lib/seeds/es/esRegionCensusData1953";
import { esRegions } from "./data/esRegions";
import { esRegions1953 } from "./data/esRegions1953";
import { esStateMetrics } from "./data/esStateMetrics";
import {
  ES_ADJACENCY_MAP,
  ES_INCOME_ANCHORS,
  ES_CONTINENT,
  ES_ISO_NUMERIC,
  ES_MAP_REGISTRY,
  ES_NPP_CAPITAL_STATE,
  ES_UN_MEMBER_SINCE,
  ES_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Spain is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Spain authors 2 census
 * eras, 1 metric eras, 0 anchor eras and 3 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  esRegions.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": esRegionCensusData1953,
  "1979-default": esRegionCensusData,
};

const metricPresetBundles = {
  "1953-default": esMetricPresets1953,
};

const populationAnchors = {};

const regionBundles = {
  "1953-default": esRegions1953,
  "1979-default": esRegions,
  "2019-default": esRegions,
};

export const ES_GEOGRAPHY: CountryGeography = {
  continent: ES_CONTINENT,

  isoNumeric: ES_ISO_NUMERIC,
  unMemberSince: ES_UN_MEMBER_SINCE,
  worldRegion: ES_WORLD_REGION,
  nppCapitalState: ES_NPP_CAPITAL_STATE,
  adjacency: ES_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: esStateMetrics,
  mapRegistry: ES_MAP_REGISTRY,
  incomeAnchors: ES_INCOME_ANCHORS,
};
