import type { CountryGeography } from "../contract";
import { huRegionCensusData1953 } from "@/lib/seeds/hu/huRegionCensusData1953";
import { huRegions } from "./data/huRegions";
import { huRegions1953 } from "./data/huRegions1953";
import {
  HU_ADJACENCY_MAP,
  HU_CONTINENT,
  HU_ISO_NUMERIC,
  HU_MAP_REGISTRY,
  HU_NPP_CAPITAL_STATE,
  HU_UN_MEMBER_SINCE,
  HU_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Hungary is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Hungary authors 1 census
 * eras, 0 metric eras, 0 anchor eras and 3 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  huRegions.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": huRegionCensusData1953,
};

const metricPresetBundles = {};

const populationAnchors = {};

const regionBundles = {
  "1953-default": huRegions1953,
  "1979-default": huRegions,
  "2019-default": huRegions,
};

export const HU_GEOGRAPHY: CountryGeography = {
  continent: HU_CONTINENT,

  isoNumeric: HU_ISO_NUMERIC,
  unMemberSince: HU_UN_MEMBER_SINCE,
  worldRegion: HU_WORLD_REGION,
  nppCapitalState: HU_NPP_CAPITAL_STATE,
  adjacency: HU_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: [],
  mapRegistry: HU_MAP_REGISTRY,
};
