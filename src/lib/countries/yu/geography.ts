import type { CountryGeography } from "../contract";
import { yuRegionCensusData1953 } from "@/lib/seeds/yu/yuRegionCensusData1953";
import { yuRegions } from "./data/yuRegions";
import { yuRegions1953 } from "./data/yuRegions1953";
import {
  YU_ADJACENCY_MAP,
  YU_CONTINENT,
  YU_ISO_NUMERIC,
  YU_MAP_REGISTRY,
  YU_NPP_CAPITAL_STATE,
  YU_UN_MEMBER_SINCE,
  YU_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Yugoslavia is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Yugoslavia authors 1 census
 * eras, 0 metric eras, 0 anchor eras and 3 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  yuRegions.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": yuRegionCensusData1953,
};

const metricPresetBundles = {};

const populationAnchors = {};

const regionBundles = {
  "1953-default": yuRegions1953,
  "1979-default": yuRegions,
  "2019-default": yuRegions,
};

export const YU_GEOGRAPHY: CountryGeography = {
  continent: YU_CONTINENT,

  isoNumeric: YU_ISO_NUMERIC,
  unMemberSince: YU_UN_MEMBER_SINCE,
  worldRegion: YU_WORLD_REGION,
  nppCapitalState: YU_NPP_CAPITAL_STATE,
  adjacency: YU_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: [],
  mapRegistry: YU_MAP_REGISTRY,
};
