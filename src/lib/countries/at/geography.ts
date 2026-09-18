import type { CountryGeography } from "../contract";
import { atMetricPresets1953 } from "./data/atMetricPresets1953";
import { atRegions } from "./data/atRegions";
import { atRegions1953 } from "./data/atRegions1953";
import { atStateMetrics } from "./data/atStateMetrics";
import {
  AT_ADJACENCY_MAP,
  AT_INCOME_ANCHORS,
  AT_CONTINENT,
  AT_ISO_NUMERIC,
  AT_MAP_REGISTRY,
  AT_NPP_CAPITAL_STATE,
  AT_UN_MEMBER_SINCE,
  AT_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Austria is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Austria authors 0 census
 * eras, 1 metric eras, 0 anchor eras and 3 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  atRegions.map((region) => [region._id, region.name])
);

const censusBundles = {};

const metricPresetBundles = {
  "1953-default": atMetricPresets1953,
};

const populationAnchors = {};

const regionBundles = {
  "1953-default": atRegions1953,
  "1979-default": atRegions,
  "2019-default": atRegions,
};

export const AT_GEOGRAPHY: CountryGeography = {
  continent: AT_CONTINENT,

  isoNumeric: AT_ISO_NUMERIC,
  unMemberSince: AT_UN_MEMBER_SINCE,
  worldRegion: AT_WORLD_REGION,
  nppCapitalState: AT_NPP_CAPITAL_STATE,
  adjacency: AT_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: atStateMetrics,
  mapRegistry: AT_MAP_REGISTRY,
  incomeAnchors: AT_INCOME_ANCHORS,
};
