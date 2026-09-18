import type { CountryGeography } from "../contract";
import { deMetricPresets1953 } from "@/lib/seeds/de/deMetricPresets1953";
import { deMetricPresets1979 } from "@/lib/seeds/de/deMetricPresets1979";
import { deMetricPresets1991, deMetricPresets2019 } from "@/lib/seeds/de/deMetricPresets";
import {
  dePopulationAnchors1991,
  dePopulationAnchors2019,
} from "@/lib/seeds/de/dePopulationAnchors";
import { deRegionCensusData } from "@/lib/seeds/de/deRegionCensusData";
import { deRegionCensusData1953 } from "@/lib/seeds/de/deRegionCensusData1953";
import { deRegionCensusData1979 } from "@/lib/seeds/de/deRegionCensusData1979";
import { deRegionCensusData1991 } from "@/lib/seeds/de/deRegionCensusData1991";
import { deRegionCensusData2027 } from "@/lib/seeds/de/deRegionCensusData2027";
import { deRegions } from "@/lib/seeds/de/deRegions";
import { deRegions1953 } from "@/lib/seeds/de/deRegions1953";
import { deRegions1979 } from "@/lib/seeds/de/deRegions1979";
import { deRegions1991 } from "@/lib/seeds/de/deRegions1991";
import { deRegions1999 } from "@/lib/seeds/de/deRegions1999";
import { deRegions2007 } from "@/lib/seeds/de/deRegions2007";
import { deRegions2023 } from "@/lib/seeds/de/deRegions2023";
import { deStateMetrics } from "@/lib/seeds/de/deStateMetrics";
import {
  DE_ADJACENCY_MAP,
  DE_CONSCRIPTION,
  DE_CONTINENT,
  DE_CORE5_NORMALS,
  DE_ISO_NUMERIC,
  DE_NON_PARTY_INDEPENDENT_BIAS,
  DE_NPP_CAPITAL_STATE,
  DE_POPULATION_MULTIPLIERS,
  DE_WORLD_REGION,
} from "./geographyFacts";
import { DE_MAP_REGISTRY } from "./data/deMapConfig";

/**
 * Where Germany is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Germany authors 5 census
 * eras, 4 metric eras, 2 anchor eras and 7 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  deRegions2023.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": deRegionCensusData1953,
  "1979-default": deRegionCensusData1979,
  "2019-default": deRegionCensusData,
  "1991-default": deRegionCensusData1991,
  "2027-default": deRegionCensusData2027,
};

const metricPresetBundles = {
  "2019-default": deMetricPresets2019,
  "1991-default": deMetricPresets1991,
  "1979-default": deMetricPresets1979,
  "1953-default": deMetricPresets1953,
};

const populationAnchors = {
  "2019-default": dePopulationAnchors2019,
  "1991-default": dePopulationAnchors1991,
};

const regionBundles = {
  "1953-default": deRegions1953,
  "1979-default": deRegions1979,
  "1991-default": deRegions1991,
  "1999-default": deRegions1999,
  "2007-default": deRegions2007,
  "2019-default": deRegions,
  "2023-default": deRegions2023,
};

export const DE_GEOGRAPHY: CountryGeography = {
  continent: DE_CONTINENT,
  isoNumeric: DE_ISO_NUMERIC,
  worldRegion: DE_WORLD_REGION,
  nppCapitalState: DE_NPP_CAPITAL_STATE,
  nonPartyIndependentBias: DE_NON_PARTY_INDEPENDENT_BIAS,
  adjacency: DE_ADJACENCY_MAP,
  regionNames,
  conscription: DE_CONSCRIPTION,
  populationMultipliers: DE_POPULATION_MULTIPLIERS,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: deStateMetrics,
  mapRegistry: DE_MAP_REGISTRY,
  core5Normals: DE_CORE5_NORMALS,
};
