import type { CountryGeography } from "../contract";
import { blrRegionCensusData } from "@/lib/seeds/blr/blrRegionCensusData";
import { blrRegionCensusData1953 } from "@/lib/seeds/blr/blrRegionCensusData1953";
import { blrRegions } from "./data/blrRegions";
import { blrRegions1953 } from "./data/blrRegions1953";
import {
  BLR_ADJACENCY_MAP,
  BLR_CONTINENT,
  BLR_ISO_NUMERIC,
  BLR_MAP_REGISTRY,
  BLR_NPP_CAPITAL_STATE,
  BLR_UN_MEMBER_SINCE,
  BLR_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Belarus is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Belarus authors 2 census
 * eras, 0 metric eras, 0 anchor eras and 2 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  blrRegions.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": blrRegionCensusData1953,
  "1979-default": blrRegionCensusData,
};

const metricPresetBundles = {};

const populationAnchors = {};

const regionBundles = {
  "1953-default": blrRegions1953,
  "2019-default": blrRegions,
};

export const BLR_GEOGRAPHY: CountryGeography = {
  continent: BLR_CONTINENT,

  isoNumeric: BLR_ISO_NUMERIC,
  unMemberSince: BLR_UN_MEMBER_SINCE,
  worldRegion: BLR_WORLD_REGION,
  nppCapitalState: BLR_NPP_CAPITAL_STATE,
  adjacency: BLR_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: [],
  mapRegistry: BLR_MAP_REGISTRY,
};
