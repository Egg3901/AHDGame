import type { CountryGeography } from "../contract";
import { ieMetricPresets1953 } from "@/lib/seeds/ie/ieMetricPresets1953";
import { ieMetricPresets1991, ieMetricPresets2019 } from "@/lib/seeds/ie/ieMetricPresets";
import {
  iePopulationAnchors1991,
  iePopulationAnchors2019,
} from "@/lib/seeds/ie/iePopulationAnchors";
import { ieRegionCensusData } from "@/lib/seeds/ie/ieRegionCensusData";
import { ieRegionCensusData1953 } from "@/lib/seeds/ie/ieRegionCensusData1953";
import { ieRegionCensusData1979 } from "@/lib/seeds/ie/ieRegionCensusData1979";
import { ieRegionCensusData1991 } from "@/lib/seeds/ie/ieRegionCensusData1991";
import { ieRegions } from "@/lib/seeds/ie/ieRegions";
import { ieRegions1953 } from "@/lib/seeds/ie/ieRegions1953";
import { ieRegions1979 } from "@/lib/seeds/ie/ieRegions1979";
import { ieRegions1991 } from "@/lib/seeds/ie/ieRegions1991";
import { ieRegions1999 } from "@/lib/seeds/ie/ieRegions1999";
import { ieRegions2007 } from "@/lib/seeds/ie/ieRegions2007";
import { ieRegions2023 } from "@/lib/seeds/ie/ieRegions2023";
import { ieStateMetrics } from "@/lib/seeds/ie/ieStateMetrics";
import {
  IE_ADJACENCY_MAP,
  IE_CONSCRIPTION,
  IE_CONTINENT,
  IE_CORE5_NORMALS,
  IE_ISO_NUMERIC,
  IE_MAP_REGISTRY,
  IE_NPP_CAPITAL_STATE,
  IE_POPULATION_MULTIPLIERS,
  IE_UN_MEMBER_SINCE,
  IE_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Ireland is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Ireland authors 4 census
 * eras, 3 metric eras, 2 anchor eras and 7 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  ieRegions2023.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": ieRegionCensusData1953,
  "1979-default": ieRegionCensusData1979,
  "2019-default": ieRegionCensusData,
  "1991-default": ieRegionCensusData1991,
};

const metricPresetBundles = {
  "2019-default": ieMetricPresets2019,
  "1991-default": ieMetricPresets1991,
  "1953-default": ieMetricPresets1953,
};

const populationAnchors = {
  "2019-default": iePopulationAnchors2019,
  "1991-default": iePopulationAnchors1991,
};

const regionBundles = {
  "1953-default": ieRegions1953,
  "1979-default": ieRegions1979,
  "1991-default": ieRegions1991,
  "1999-default": ieRegions1999,
  "2007-default": ieRegions2007,
  "2019-default": ieRegions,
  "2023-default": ieRegions2023,
};

export const IE_GEOGRAPHY: CountryGeography = {
  continent: IE_CONTINENT,
  isoNumeric: IE_ISO_NUMERIC,
  unMemberSince: IE_UN_MEMBER_SINCE,
  worldRegion: IE_WORLD_REGION,
  nppCapitalState: IE_NPP_CAPITAL_STATE,
  adjacency: IE_ADJACENCY_MAP,
  regionNames,
  conscription: IE_CONSCRIPTION,
  populationMultipliers: IE_POPULATION_MULTIPLIERS,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: ieStateMetrics,
  mapRegistry: IE_MAP_REGISTRY,
  core5Normals: IE_CORE5_NORMALS,
};
