import type { CountryGeography } from "../contract";
import { grMetricPresets1953 } from "./data/grMetricPresets1953";
import { grRegions } from "./data/grRegions";
import { grRegions1953 } from "./data/grRegions1953";
import { grStateMetrics } from "./data/grStateMetrics";
import {
  GR_ADJACENCY_MAP,
  GR_INCOME_ANCHORS,
  GR_CONTINENT,
  GR_ISO_NUMERIC,
  GR_MAP_REGISTRY,
  GR_NPP_CAPITAL_STATE,
  GR_UN_MEMBER_SINCE,
  GR_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Greece is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Greece authors 0 census
 * eras, 1 metric eras, 0 anchor eras and 3 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  grRegions.map((region) => [region._id, region.name])
);

const censusBundles = {};

const metricPresetBundles = {
  "1953-default": grMetricPresets1953,
};

const populationAnchors = {};

const regionBundles = {
  "1953-default": grRegions1953,
  "1979-default": grRegions,
  "2019-default": grRegions,
};

export const GR_GEOGRAPHY: CountryGeography = {
  continent: GR_CONTINENT,

  isoNumeric: GR_ISO_NUMERIC,
  unMemberSince: GR_UN_MEMBER_SINCE,
  worldRegion: GR_WORLD_REGION,
  nppCapitalState: GR_NPP_CAPITAL_STATE,
  adjacency: GR_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: grStateMetrics,
  mapRegistry: GR_MAP_REGISTRY,
  incomeAnchors: GR_INCOME_ANCHORS,
};
