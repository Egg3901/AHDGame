import type { CountryGeography } from "../contract";
import { itMetricPresets1953 } from "./data/itMetricPresets1953";
import { itRegionCensusData } from "./data/itRegionCensusData";
import { itRegionCensusData1953 } from "./data/itRegionCensusData1953";
import { itRegions } from "./data/itRegions";
import { itRegions1953 } from "./data/itRegions1953";
import { itStateMetrics } from "./data/itStateMetrics";
import {
  IT_ADJACENCY_MAP,
  IT_INCOME_ANCHORS,
  IT_CONTINENT,
  IT_ISO_NUMERIC,
  IT_MAP_REGISTRY,
  IT_NPP_CAPITAL_STATE,
  IT_UN_MEMBER_SINCE,
  IT_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Italy is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Italy authors 2 census
 * eras, 1 metric eras, 0 anchor eras and 3 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  itRegions.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": itRegionCensusData1953,
  "1979-default": itRegionCensusData,
};

const metricPresetBundles = {
  "1953-default": itMetricPresets1953,
};

const populationAnchors = {};

const regionBundles = {
  "1953-default": itRegions1953,
  "1979-default": itRegions,
  "2019-default": itRegions,
};

export const IT_GEOGRAPHY: CountryGeography = {
  continent: IT_CONTINENT,

  isoNumeric: IT_ISO_NUMERIC,
  unMemberSince: IT_UN_MEMBER_SINCE,
  worldRegion: IT_WORLD_REGION,
  nppCapitalState: IT_NPP_CAPITAL_STATE,
  adjacency: IT_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: itStateMetrics,
  mapRegistry: IT_MAP_REGISTRY,
  incomeAnchors: IT_INCOME_ANCHORS,
};
