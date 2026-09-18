import type { CountryGeography } from "../contract";
import { roRegionCensusData1953 } from "@/lib/seeds/ro/roRegionCensusData1953";
import { roRegions } from "./data/roRegions";
import { roRegions1953 } from "./data/roRegions1953";
import {
  RO_ADJACENCY_MAP,
  RO_CONTINENT,
  RO_ISO_NUMERIC,
  RO_MAP_REGISTRY,
  RO_NPP_CAPITAL_STATE,
  RO_UN_MEMBER_SINCE,
  RO_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Romania is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Romania authors 1 census
 * eras, 0 metric eras, 0 anchor eras and 3 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  roRegions.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": roRegionCensusData1953,
};

const metricPresetBundles = {};

const populationAnchors = {};

const regionBundles = {
  "1953-default": roRegions1953,
  "1979-default": roRegions,
  "2019-default": roRegions,
};

export const RO_GEOGRAPHY: CountryGeography = {
  continent: RO_CONTINENT,

  isoNumeric: RO_ISO_NUMERIC,
  unMemberSince: RO_UN_MEMBER_SINCE,
  worldRegion: RO_WORLD_REGION,
  nppCapitalState: RO_NPP_CAPITAL_STATE,
  adjacency: RO_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: [],
  mapRegistry: RO_MAP_REGISTRY,
};
