import type { CountryGeography } from "../contract";
import { scoRegionCensusData, scoRegionCensusData1991 } from "@/lib/seeds/sco/scoRegionCensusData";
import { scoRegions } from "./data/scoRegions";
import {
  SCO_ADJACENCY_MAP,
  SCO_CONTINENT,
  SCO_ISO_NUMERIC,
  SCO_MAP_REGISTRY,
  SCO_NPP_CAPITAL_STATE,
  SCO_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Scotland is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Scotland authors 2 census
 * eras, 0 metric eras, 0 anchor eras and 1 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  scoRegions.map((region) => [region._id, region.name])
);

const censusBundles = {
  "2019-default": scoRegionCensusData,
  "1991-default": scoRegionCensusData1991,
};

const metricPresetBundles = {};

const populationAnchors = {};

const regionBundles = {
  "2019-default": scoRegions,
};

export const SCO_GEOGRAPHY: CountryGeography = {
  continent: SCO_CONTINENT,

  isoNumeric: SCO_ISO_NUMERIC,
  worldRegion: SCO_WORLD_REGION,
  nppCapitalState: SCO_NPP_CAPITAL_STATE,
  adjacency: SCO_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: [],
  mapRegistry: SCO_MAP_REGISTRY,
  demographicCategoryIds: ["uk_voterGroups"],
};
