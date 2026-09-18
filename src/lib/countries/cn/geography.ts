import type { CountryGeography } from "../contract";
import { cnMetricPresets1953 } from "@/lib/seeds/cn/cnMetricPresets1953";
import { cnMetricPresets1979 } from "@/lib/seeds/cn/cnMetricPresets1979";
import { cnMetricPresets1991, cnMetricPresets2019 } from "@/lib/seeds/cn/cnMetricPresets";
import {
  cnPopulationAnchors1991,
  cnPopulationAnchors2019,
} from "@/lib/seeds/cn/cnPopulationAnchors";
import { cnRegionCensusData } from "@/lib/seeds/cn/cnRegionCensusData";
import { cnRegionCensusData1953 } from "@/lib/seeds/cn/cnRegionCensusData1953";
import { cnRegionCensusData1979 } from "@/lib/seeds/cn/cnRegionCensusData1979";
import { cnRegionCensusData1991 } from "@/lib/seeds/cn/cnRegionCensusData1991";
import { cnRegionCensusData2027 } from "@/lib/seeds/cn/cnRegionCensusData2027";
import { cnRegions } from "@/lib/seeds/cn/cnRegions";
import { cnRegions1953 } from "@/lib/seeds/cn/cnRegions1953";
import { cnRegions1979 } from "@/lib/seeds/cn/cnRegions1979";
import { cnRegions1991 } from "@/lib/seeds/cn/cnRegions1991";
import { cnRegions1999 } from "@/lib/seeds/cn/cnRegions1999";
import { cnRegions2007 } from "@/lib/seeds/cn/cnRegions2007";
import { cnRegions2023 } from "@/lib/seeds/cn/cnRegions2023";
import { cnStateMetrics } from "@/lib/seeds/cn/cnStateMetrics";
import {
  CN_ADJACENCY_MAP,
  CN_CONSCRIPTION,
  CN_CONTINENT,
  CN_CORE5_NORMALS,
  CN_ISO_NUMERIC,
  CN_MAP_REGISTRY,
  CN_NPP_CAPITAL_STATE,
  CN_POPULATION_MULTIPLIERS,
  CN_UN_MEMBER_SINCE,
  CN_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where China is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. China authors 5 census
 * eras, 4 metric eras, 2 anchor eras and 7 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  cnRegions2023.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": cnRegionCensusData1953,
  "1979-default": cnRegionCensusData1979,
  "2019-default": cnRegionCensusData,
  "1991-default": cnRegionCensusData1991,
  "2027-default": cnRegionCensusData2027,
};

const metricPresetBundles = {
  "2019-default": cnMetricPresets2019,
  "1991-default": cnMetricPresets1991,
  "1979-default": cnMetricPresets1979,
  "1953-default": cnMetricPresets1953,
};

const populationAnchors = {
  "2019-default": cnPopulationAnchors2019,
  "1991-default": cnPopulationAnchors1991,
};

const regionBundles = {
  "1953-default": cnRegions1953,
  "1979-default": cnRegions1979,
  "1991-default": cnRegions1991,
  "1999-default": cnRegions1999,
  "2007-default": cnRegions2007,
  "2019-default": cnRegions,
  "2023-default": cnRegions2023,
};

export const CN_GEOGRAPHY: CountryGeography = {
  continent: CN_CONTINENT,
  isoNumeric: CN_ISO_NUMERIC,
  unMemberSince: CN_UN_MEMBER_SINCE,
  worldRegion: CN_WORLD_REGION,
  nppCapitalState: CN_NPP_CAPITAL_STATE,
  adjacency: CN_ADJACENCY_MAP,
  regionNames,
  conscription: CN_CONSCRIPTION,
  populationMultipliers: CN_POPULATION_MULTIPLIERS,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: cnStateMetrics,
  mapRegistry: CN_MAP_REGISTRY,
  core5Normals: CN_CORE5_NORMALS,
};
