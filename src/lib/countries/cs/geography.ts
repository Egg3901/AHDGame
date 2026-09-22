import type { CountryGeography } from "../contract";
import { csRegionCensusData1953 } from "@/lib/seeds/cs/csRegionCensusData1953";
import { csRegions } from "./data/csRegions";
import { csRegions1953 } from "./data/csRegions1953";
import {
  CS_ADJACENCY_MAP,
  CS_CONTINENT,
  CS_ISO_NUMERIC,
  CS_MAP_REGISTRY,
  CS_NPP_CAPITAL_STATE,
  CS_UN_MEMBER_SINCE,
  CS_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Czechoslovakia is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Czechoslovakia authors 1 census
 * eras, 0 metric eras, 0 anchor eras and 3 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  csRegions.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": csRegionCensusData1953,
};

const metricPresetBundles = {};

const populationAnchors = {};

const regionBundles = {
  "1953-default": csRegions1953,
  "1979-default": csRegions,
  "2019-default": csRegions,
};

export const CS_GEOGRAPHY: CountryGeography = {
  continent: CS_CONTINENT,

  isoNumeric: CS_ISO_NUMERIC,
  unMemberSince: CS_UN_MEMBER_SINCE,
  worldRegion: CS_WORLD_REGION,
  nppCapitalState: CS_NPP_CAPITAL_STATE,
  adjacency: CS_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: [],
  mapRegistry: CS_MAP_REGISTRY,
};
