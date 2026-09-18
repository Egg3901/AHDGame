import type { CountryGeography } from "../contract";
import { brMetricPresets1953 } from "@/lib/seeds/br/brMetricPresets1953";
import { brMetricPresets1979 } from "@/lib/seeds/br/brMetricPresets1979";
import { brMetricPresets1991, brMetricPresets2019 } from "@/lib/seeds/br/brMetricPresets";
import {
  brPopulationAnchors1991,
  brPopulationAnchors2019,
} from "@/lib/seeds/br/brPopulationAnchors";
import { brRegionCensusData } from "@/lib/seeds/br/brRegionCensusData";
import { brRegionCensusData1953 } from "@/lib/seeds/br/brRegionCensusData1953";
import { brRegionCensusData1979 } from "@/lib/seeds/br/brRegionCensusData1979";
import { brRegionCensusData1991 } from "@/lib/seeds/br/brRegionCensusData1991";
import { brRegions } from "@/lib/seeds/br/brRegions";
import { brRegions1953 } from "@/lib/seeds/br/brRegions1953";
import { brRegions1979 } from "@/lib/seeds/br/brRegions1979";
import { brRegions1991 } from "@/lib/seeds/br/brRegions1991";
import { brRegions1999 } from "@/lib/seeds/br/brRegions1999";
import { brRegions2007 } from "@/lib/seeds/br/brRegions2007";
import { brRegions2023 } from "@/lib/seeds/br/brRegions2023";
import { brStateMetrics } from "@/lib/seeds/br/brStateMetrics";
import {
  BR_ADJACENCY_MAP,
  BR_CONSCRIPTION,
  BR_CONTINENT,
  BR_CORE5_NORMALS,
  BR_ISO_NUMERIC,
  BR_MAP_REGISTRY,
  BR_NPP_CAPITAL_STATE,
  BR_POPULATION_MULTIPLIERS,
  BR_UN_MEMBER_SINCE,
  BR_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Brazil is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Brazil authors 4 census
 * eras, 4 metric eras, 2 anchor eras and 7 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  brRegions2023.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": brRegionCensusData1953,
  "1979-default": brRegionCensusData1979,
  "2019-default": brRegionCensusData,
  "1991-default": brRegionCensusData1991,
};

const metricPresetBundles = {
  "2019-default": brMetricPresets2019,
  "1991-default": brMetricPresets1991,
  "1979-default": brMetricPresets1979,
  "1953-default": brMetricPresets1953,
};

const populationAnchors = {
  "2019-default": brPopulationAnchors2019,
  "1991-default": brPopulationAnchors1991,
};

const regionBundles = {
  "1953-default": brRegions1953,
  "1979-default": brRegions1979,
  "1991-default": brRegions1991,
  "1999-default": brRegions1999,
  "2007-default": brRegions2007,
  "2019-default": brRegions,
  "2023-default": brRegions2023,
};

export const BR_GEOGRAPHY: CountryGeography = {
  continent: BR_CONTINENT,
  isoNumeric: BR_ISO_NUMERIC,
  unMemberSince: BR_UN_MEMBER_SINCE,
  worldRegion: BR_WORLD_REGION,
  nppCapitalState: BR_NPP_CAPITAL_STATE,
  conscription: BR_CONSCRIPTION,
  populationMultipliers: BR_POPULATION_MULTIPLIERS,
  core5Normals: BR_CORE5_NORMALS,
  adjacency: BR_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: brStateMetrics,
  mapRegistry: BR_MAP_REGISTRY,
};
