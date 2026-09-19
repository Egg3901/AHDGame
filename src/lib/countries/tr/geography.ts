import type { CountryGeography } from "../contract";
import { trMetricPresets1953 } from "./data/trMetricPresets1953";
import { trRegionCensusData } from "@/lib/seeds/tr/trRegionCensusData";
import { trRegionCensusData1953 } from "@/lib/seeds/tr/trRegionCensusData1953";
import { trRegions } from "./data/trRegions";
import { trRegions1953 } from "./data/trRegions1953";
import { trStateMetrics } from "./data/trStateMetrics";
import {
  TR_ADJACENCY_MAP,
  TR_INCOME_ANCHORS,
  TR_CONTINENT,
  TR_ISO_NUMERIC,
  TR_MAP_REGISTRY,
  TR_NPP_CAPITAL_STATE,
  TR_UN_MEMBER_SINCE,
  TR_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Turkey is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Turkey authors 3 census
 * eras, 1 metric eras, 0 anchor eras and 3 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  trRegions.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": trRegionCensusData1953,
  "1979-default": trRegionCensusData,
  "2019-default": trRegionCensusData,
};

const metricPresetBundles = {
  "1953-default": trMetricPresets1953,
};

const populationAnchors = {};

const regionBundles = {
  "1953-default": trRegions1953,
  "1979-default": trRegions,
  "2019-default": trRegions,
};

export const TR_GEOGRAPHY: CountryGeography = {
  continent: TR_CONTINENT,

  isoNumeric: TR_ISO_NUMERIC,
  unMemberSince: TR_UN_MEMBER_SINCE,
  worldRegion: TR_WORLD_REGION,
  nppCapitalState: TR_NPP_CAPITAL_STATE,
  adjacency: TR_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: trStateMetrics,
  mapRegistry: TR_MAP_REGISTRY,
  incomeAnchors: TR_INCOME_ANCHORS,
};
