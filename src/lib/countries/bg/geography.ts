import type { CountryGeography } from "../contract";
import { bgRegionCensusData1953 } from "@/lib/seeds/bg/bgRegionCensusData1953";
import { bgRegions } from "./data/bgRegions";
import { bgRegions1953 } from "./data/bgRegions1953";
import {
  BG_ADJACENCY_MAP,
  BG_CONTINENT,
  BG_ISO_NUMERIC,
  BG_MAP_REGISTRY,
  BG_NPP_CAPITAL_STATE,
  BG_UN_MEMBER_SINCE,
  BG_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Bulgaria is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Bulgaria authors 1 census
 * eras, 0 metric eras, 0 anchor eras and 3 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  bgRegions.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": bgRegionCensusData1953,
};

const metricPresetBundles = {};

const populationAnchors = {};

const regionBundles = {
  "1953-default": bgRegions1953,
  "1979-default": bgRegions,
  "2019-default": bgRegions,
};

export const BG_GEOGRAPHY: CountryGeography = {
  continent: BG_CONTINENT,

  isoNumeric: BG_ISO_NUMERIC,
  unMemberSince: BG_UN_MEMBER_SINCE,
  worldRegion: BG_WORLD_REGION,
  nppCapitalState: BG_NPP_CAPITAL_STATE,
  adjacency: BG_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: [],
  mapRegistry: BG_MAP_REGISTRY,
};
