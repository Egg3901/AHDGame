import type { CountryModifierPatch } from "@/lib/states/conditions/countryPatches";
import { condition as c } from "@/lib/states/conditions/condition";
import type { CountryGeography } from "../contract";
import { ieMetricPresets1953 } from "./data/ieMetricPresets1953";
import { ieMetricPresets1991, ieMetricPresets2019 } from "./data/ieMetricPresets";
import { iePopulationAnchors1991, iePopulationAnchors2019 } from "./data/iePopulationAnchors";
import { ieRegionCensusData } from "./data/ieRegionCensusData";
import { ieRegionCensusData1953 } from "./data/ieRegionCensusData1953";
import { ieRegionCensusData1979 } from "./data/ieRegionCensusData1979";
import { ieRegionCensusData1991 } from "./data/ieRegionCensusData1991";
import { ieRegions } from "./data/ieRegions";
import { ieRegions1953 } from "./data/ieRegions1953";
import { ieRegions1979 } from "./data/ieRegions1979";
import { ieRegions1991 } from "./data/ieRegions1991";
import { ieRegions1999 } from "./data/ieRegions1999";
import { ieRegions2007 } from "./data/ieRegions2007";
import { ieRegions2023 } from "./data/ieRegions2023";
import { ieStateMetrics } from "./data/ieStateMetrics";
import {
  IE_ADJACENCY_MAP,
  IE_INCOME_ANCHORS,
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

/** Base-era per-modifier threshold overrides and suppressions. */
const modifierPatches: Record<string, CountryModifierPatch> = {
  universal_healthcare: { suppress: true },
  safe_streets: { suppress: true },
  falling_crime: { suppress: true },
  high_life_expectancy: { suppress: true },
  longevity: { suppress: true },
  low_unemployment: { suppress: true },
  poor_air_quality: { suppress: true },
  corruption_concerns: { suppress: true },
  high_corruption: { suppress: true },
  free_press: { suppress: true },
  balanced_budget: { suppress: true },
  strong_safety_net: { suppress: true },
  clean_water: { suppress: true },
  green_transition: { suppress: true },
  educated_workforce: { suppress: true },
  innovation_economy: { suppress: true },
  high_immigration: { suppress: true },
  population_boom: { suppress: true },
  brain_gain: { suppress: true },
  youth_surge: { suppress: true },
  crime_wave: { suppress: true },
  high_violent_crime: { suppress: true },
  housing_stress: { conditions: [c("social", "housingAffordability", ">=", 80)] },
  affordable_housing: { conditions: [c("social", "housingAffordability", "<=", 55)] },
  research_hub: { conditions: [c("economic", "rdIntensity", ">=", 2.4)] },
  strong_growth: { conditions: [c("economic", "gdpGrowth", ">=", 3.8)] },
  slow_growth: { conditions: [c("economic", "gdpGrowth", "<=", 1.5)] },
  heavy_public_debt: { conditions: [c("governance", "debtToGdp", ">=", 50)] },
};

export const IE_GEOGRAPHY: CountryGeography = {
  continent: IE_CONTINENT,

  isoNumeric: IE_ISO_NUMERIC,
  unMemberSince: IE_UN_MEMBER_SINCE,
  worldRegion: IE_WORLD_REGION,
  nppCapitalState: IE_NPP_CAPITAL_STATE,
  conscription: IE_CONSCRIPTION,
  populationMultipliers: IE_POPULATION_MULTIPLIERS,
  core5Normals: IE_CORE5_NORMALS,
  adjacency: IE_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: ieStateMetrics,
  mapRegistry: IE_MAP_REGISTRY,
  incomeAnchors: IE_INCOME_ANCHORS,
  calibrationTargets: {
    "1979": {
      center: 0,
      centerTol: 0.8,
      minSpread: 1,
      expectLeft: ["DUB"],
      expectRight: [],
      election: "Ireland 1977 Dáil (low confidence — left/right weak)",
    },
    "1991": {
      center: 0,
      centerTol: 0.8,
      minSpread: 1,
      expectLeft: ["DUB"],
      expectRight: [],
      election: "Ireland 1989 Dáil (low confidence)",
    },
    "1999": {
      center: 0,
      centerTol: 0.8,
      minSpread: 1,
      expectLeft: ["DUB"],
      expectRight: [],
      election: "Ireland 1997 Dáil (low confidence)",
    },
    "2007": {
      center: 0,
      centerTol: 0.8,
      minSpread: 1,
      expectLeft: ["DUB"],
      expectRight: [],
      election: "Ireland 2007 Dáil (low confidence)",
    },
    "2019": {
      center: 0,
      centerTol: 0.8,
      minSpread: 1,
      expectLeft: ["DUB"],
      expectRight: [],
      election: "Ireland 2020 Dáil (SF urban surge — low confidence)",
    },
    "2023": {
      center: 0,
      centerTol: 0.8,
      minSpread: 1,
      expectLeft: ["DUB"],
      expectRight: [],
      election: "Ireland 2020 Dáil (low confidence)",
    },
  },
  modifierPatches: modifierPatches,
  era1991Patches: {
    affordable_housing: {
      conditions: [
        {
          category: "social",
          metric: "housingAffordability",
          op: "<=",
          value: 28,
        },
      ],
    },
    housing_stress: {
      conditions: [
        {
          category: "social",
          metric: "housingAffordability",
          op: ">=",
          value: 38,
        },
      ],
    },
    heavy_public_debt: {
      conditions: [
        {
          category: "governance",
          metric: "debtToGdp",
          op: ">=",
          value: 98,
        },
      ],
    },
    slow_growth: {
      conditions: [
        {
          category: "economic",
          metric: "gdpGrowth",
          op: "<=",
          value: 0.5,
        },
      ],
    },
    research_hub: {
      suppress: true,
    },
  },
  hazardGroups: {
    coastal: ["DUB", "WEX", "COR", "GAL", "DON", "LIM"],
    flood: ["DUB", "KIL", "MID", "WEX", "LIM", "COR", "GAL", "DON"],
    wintry: ["DON"],
  },
  demographicCategoryIds: ["ie_voterGroups"],
};
