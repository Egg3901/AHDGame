import type { CountryGeography } from "../contract";
import { ukRegionCensusData } from "./data/ukRegionCensusData";
import { ukRegionCensusData1953 } from "./data/ukRegionCensusData1953";
import { ukRegionCensusData1979 } from "./data/ukRegionCensusData1979";
import { ukRegionCensusData1991 } from "./data/ukRegionCensusData1991";
import { ukRegionCensusData2027 } from "./data/ukRegionCensusData2027";
import { ukMetricPresets1953 } from "./data/ukMetricPresets1953";
import { ukMetricPresets1979 } from "./data/ukMetricPresets1979";
import { ukMetricPresets1991, ukMetricPresets2019 } from "./data/ukMetricPresets";
import { ukPopulationAnchors1991, ukPopulationAnchors2019 } from "./data/ukPopulationAnchors";
import { ukRegions } from "./data/ukRegions";
import { ukRegions1953 } from "./data/ukRegions1953";
import { ukRegions1979 } from "./data/ukRegions1979";
import { ukRegions1991 } from "./data/ukRegions1991";
import { ukRegions1999 } from "./data/ukRegions1999";
import { ukRegions2007 } from "./data/ukRegions2007";
import { ukRegions2023 } from "./data/ukRegions2023";
import { ukStateMetrics } from "./data/ukStateMetrics";
import { UK_REGIONS } from "@/lib/constants/uk";
import {
  UK_ADJACENCY_MAP,
  UK_CONSCRIPTION,
  UK_CONTINENT,
  UK_CORE5_NORMALS,
  UK_ISO_NUMERIC,
  UK_MAP_REGISTRY,
  UK_NON_PARTY_INDEPENDENT_BIAS,
  UK_NPP_CAPITAL_STATE,
  UK_POPULATION_MULTIPLIERS,
  UK_UN_MEMBER_SINCE,
  UK_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where the United Kingdom is, and who lives there.
 *
 * ⚠️ HEAVY. It imports every era of census, metric and region data as VALUES. A
 * registry that needs one string imports `./geographyFacts` instead, which has
 * no value imports at all. `countryContinents.ts` once held `JP: "Asia"` at zero
 * cost, was repointed at the heavy module, and began pulling 108 KB into every
 * client bundle that read a continent.
 *
 * ⚠️ EVERY BUNDLE IS REFERENCED, NEVER INLINED. Japan's early revision generated
 * copies of its census bundles from the snapshot; deep equality passed and Japan
 * quietly had two sources for every region. `===` is what catches that, and the
 * harness checks it.
 *
 * ⚠️ THE DATA MOVED, AND AN EARLIER DRAFT OF THIS COMMENT ARGUED IT SHOULD NOT.
 * It said `seeds/uk/`'s 35 files were "already named for their country" so
 * relocating them would be "churn, not clarification". That was a
 * rationalisation, and Japan's own history refutes it: `seeds/jp/` does not
 * exist any more, because Japan's seeds were relocated into `jp/data/` during
 * D6. One country per folder means one PLACE, not one naming convention.
 */

/**
 * Region display names, derived from the region directory.
 *
 * ⚠️ DERIVED, NOT AUTHORED. `UK_REGIONS` already carries each region's name, and
 * writing the twelve out again would be a second source that agrees only until
 * one side is edited -- which is exactly what happened to Japan, whose region
 * names lived in both `JP_REGIONS[].name` and `JP_GEOGRAPHY.regionNames`.
 */
const regionNames: Record<string, string> = Object.fromEntries(
  UK_REGIONS.map((region) => [region.id, region.name])
);

const censusBundles = {
  "1953-default": ukRegionCensusData1953,
  "1979-default": ukRegionCensusData1979,
  "1991-default": ukRegionCensusData1991,
  "2019-default": ukRegionCensusData,
  "2027-default": ukRegionCensusData2027,
};

const metricPresets = {
  "1953-default": ukMetricPresets1953,
  "1979-default": ukMetricPresets1979,
  "1991-default": ukMetricPresets1991,
  "2019-default": ukMetricPresets2019,
};

const populationAnchors = {
  "1991-default": ukPopulationAnchors1991,
  "2019-default": ukPopulationAnchors2019,
};

const regionBundles = {
  "1953-default": ukRegions1953,
  "1979-default": ukRegions1979,
  "1991-default": ukRegions1991,
  "1999-default": ukRegions1999,
  "2007-default": ukRegions2007,
  "2019-default": ukRegions,
  "2023-default": ukRegions2023,
};

export const UK_GEOGRAPHY: CountryGeography = {
  continent: UK_CONTINENT,
  isoNumeric: UK_ISO_NUMERIC,
  unMemberSince: UK_UN_MEMBER_SINCE,
  worldRegion: UK_WORLD_REGION,
  nppCapitalState: UK_NPP_CAPITAL_STATE,
  nonPartyIndependentBias: UK_NON_PARTY_INDEPENDENT_BIAS,
  adjacency: UK_ADJACENCY_MAP,
  regionNames,
  demographicCategoryIds: ["uk_voterGroups"],
  conscription: UK_CONSCRIPTION,
  populationMultipliers: UK_POPULATION_MULTIPLIERS,
  censusBundles,
  populationAnchors,
  metricPresets,
  regionBundles,
  rawMetrics: ukStateMetrics,
  mapRegistry: UK_MAP_REGISTRY,
  core5Normals: UK_CORE5_NORMALS,
};
