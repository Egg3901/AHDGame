import type { CountryGeography } from "../contract";
import { fiMetricPresets1953 } from "./data/fiMetricPresets1953";
import { fiRegions } from "./data/fiRegions";
import { fiRegions1953 } from "./data/fiRegions1953";
import { fiStateMetrics } from "./data/fiStateMetrics";
import {
  FI_ADJACENCY_MAP,
  FI_INCOME_ANCHORS,
  FI_CONTINENT,
  FI_ISO_NUMERIC,
  FI_MAP_REGISTRY,
  FI_NPP_CAPITAL_STATE,
  FI_UN_MEMBER_SINCE,
  FI_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Finland is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Finland authors 0 census
 * eras, 1 metric eras, 0 anchor eras and 3 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  fiRegions.map((region) => [region._id, region.name])
);

const censusBundles = {};

const metricPresetBundles = {
  "1953-default": fiMetricPresets1953,
};

const populationAnchors = {};

const regionBundles = {
  "1953-default": fiRegions1953,
  "1979-default": fiRegions,
  "2019-default": fiRegions,
};

export const FI_GEOGRAPHY: CountryGeography = {
  continent: FI_CONTINENT,

  isoNumeric: FI_ISO_NUMERIC,
  unMemberSince: FI_UN_MEMBER_SINCE,
  worldRegion: FI_WORLD_REGION,
  nppCapitalState: FI_NPP_CAPITAL_STATE,
  adjacency: FI_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: fiStateMetrics,
  mapRegistry: FI_MAP_REGISTRY,
  incomeAnchors: FI_INCOME_ANCHORS,
};
