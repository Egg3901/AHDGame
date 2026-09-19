import type { CountryGeography } from "../contract";
import { balRegionCensusData } from "@/lib/seeds/bal/balRegionCensusData";
import { balRegionCensusData1953 } from "@/lib/seeds/bal/balRegionCensusData1953";
import { balRegions } from "./data/balRegions";
import { balRegions1953 } from "./data/balRegions1953";
import {
  BAL_ADJACENCY_MAP,
  BAL_CONTINENT,
  BAL_MAP_REGISTRY,
  BAL_NPP_CAPITAL_STATE,
  BAL_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where the Baltic States is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. the Baltic States authors 2 census
 * eras, 0 metric eras, 0 anchor eras and 2 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  balRegions.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": balRegionCensusData1953,
  "1979-default": balRegionCensusData,
};

const metricPresetBundles = {};

const populationAnchors = {};

const regionBundles = {
  "1953-default": balRegions1953,
  "2019-default": balRegions,
};

export const BAL_GEOGRAPHY: CountryGeography = {
  continent: BAL_CONTINENT,

  worldRegion: BAL_WORLD_REGION,
  nppCapitalState: BAL_NPP_CAPITAL_STATE,
  adjacency: BAL_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: [],
  mapRegistry: BAL_MAP_REGISTRY,
};
