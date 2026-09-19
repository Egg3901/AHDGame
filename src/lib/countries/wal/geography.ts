import type { CountryGeography } from "../contract";
import { walRegionCensusData, walRegionCensusData1991 } from "@/lib/seeds/wal/walRegionCensusData";
import { walRegions } from "./data/walRegions";
import {
  WAL_ADJACENCY_MAP,
  WAL_CONTINENT,
  WAL_ISO_NUMERIC,
  WAL_MAP_REGISTRY,
  WAL_NPP_CAPITAL_STATE,
  WAL_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Wales is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Wales authors 2 census
 * eras, 0 metric eras, 0 anchor eras and 1 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  walRegions.map((region) => [region._id, region.name])
);

const censusBundles = {
  "2019-default": walRegionCensusData,
  "1991-default": walRegionCensusData1991,
};

const metricPresetBundles = {};

const populationAnchors = {};

const regionBundles = {
  "2019-default": walRegions,
};

export const WAL_GEOGRAPHY: CountryGeography = {
  continent: WAL_CONTINENT,

  isoNumeric: WAL_ISO_NUMERIC,
  worldRegion: WAL_WORLD_REGION,
  nppCapitalState: WAL_NPP_CAPITAL_STATE,
  adjacency: WAL_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: [],
  mapRegistry: WAL_MAP_REGISTRY,
  demographicCategoryIds: ["uk_voterGroups"],
};
