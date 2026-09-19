import type { CountryModifierPatch } from "@/lib/states/conditions/countryPatches";
import { condition as c } from "@/lib/states/conditions/condition";
import type { CountryGeography } from "../contract";
import { brMetricPresets1953 } from "./data/brMetricPresets1953";
import { brMetricPresets1979 } from "./data/brMetricPresets1979";
import { brMetricPresets1991, brMetricPresets2019 } from "./data/brMetricPresets";
import { brPopulationAnchors1991, brPopulationAnchors2019 } from "./data/brPopulationAnchors";
import { brRegionCensusData } from "./data/brRegionCensusData";
import { brRegionCensusData1953 } from "./data/brRegionCensusData1953";
import { brRegionCensusData1979 } from "./data/brRegionCensusData1979";
import { brRegionCensusData1991 } from "./data/brRegionCensusData1991";
import { brRegions } from "./data/brRegions";
import { brRegions1953 } from "./data/brRegions1953";
import { brRegions1979 } from "./data/brRegions1979";
import { brRegions1991 } from "./data/brRegions1991";
import { brRegions1999 } from "./data/brRegions1999";
import { brRegions2007 } from "./data/brRegions2007";
import { brRegions2023 } from "./data/brRegions2023";
import { brStateMetrics } from "./data/brStateMetrics";
import {
  BR_ADJACENCY_MAP,
  BR_INCOME_ANCHORS,
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

/** Base-era per-modifier threshold overrides and suppressions. */
const modifierPatches: Record<string, CountryModifierPatch> = {
  universal_healthcare: { suppress: true },
  crime_wave: { suppress: true },
  high_violent_crime: { suppress: true },
  poor_air_quality: { suppress: true },
  corruption_concerns: { suppress: true },
  high_corruption: { suppress: true },
  low_public_trust: { suppress: true },
  government_deficit: { suppress: true },
  fiscal_crisis: { suppress: true },
  green_transition: { suppress: true },
  high_voter_turnout: { suppress: true },
  civic_flourishing: { suppress: true },
  information_disorder: { suppress: true },
  media_polarization: { suppress: true },
  free_press: { suppress: true },
  high_poverty: { conditions: [c("economic", "povertyRate", ">=", 40)] },
  low_poverty: { conditions: [c("economic", "povertyRate", "<=", 18)] },
  housing_stress: { conditions: [c("social", "housingAffordability", ">=", 55)] },
  affordable_housing: { conditions: [c("social", "housingAffordability", "<=", 42)] },
  research_hub: { conditions: [c("economic", "rdIntensity", ">=", 1.6)] },
  strong_growth: { conditions: [c("economic", "gdpGrowth", ">=", 4.0)] },
  slow_growth: { conditions: [c("economic", "gdpGrowth", "<=", 2.5)] },
  low_social_mobility: { suppress: true },
  income_inequality: { suppress: true },
  food_insecurity: { suppress: true },
  social_breakdown: { suppress: true },
  youth_surge: { suppress: true },
  low_life_expectancy: { suppress: true },
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
  incomeAnchors: BR_INCOME_ANCHORS,
  calibrationTargets: {
    "1991": {
      center: 0,
      centerTol: 0.8,
      minSpread: 1,
      expectLeft: [],
      expectRight: [],
      election: "Brazil 1989 presidential (pre-Lula cleavage — center/spread only)",
    },
    "1999": {
      center: 0,
      centerTol: 0.8,
      minSpread: 1,
      expectLeft: [],
      expectRight: [],
      election: "Brazil 1998 presidential (center/spread only)",
    },
    "2007": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.2,
      expectLeft: ["NORDESTE"],
      expectRight: ["SUL"],
      election: "Brazil 2006 presidential (Lula; Nordeste left emerging)",
    },
    "2019": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.3,
      expectLeft: ["NORDESTE"],
      expectRight: ["SUL", "CENTRO_OESTE"],
      election: "Brazil 2018 presidential",
    },
    "2023": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.3,
      expectLeft: ["NORDESTE", "NORTE"],
      expectRight: ["SUL", "CENTRO_OESTE"],
      election: "Brazil 2022 presidential (Lula v Bolsonaro)",
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
          value: 34,
        },
      ],
    },
    high_poverty: {
      conditions: [
        {
          category: "economic",
          metric: "povertyRate",
          op: ">=",
          value: 22,
        },
      ],
    },
    slow_growth: {
      conditions: [
        {
          category: "economic",
          metric: "gdpGrowth",
          op: "<=",
          value: 1,
        },
      ],
    },
    research_hub: {
      suppress: true,
    },
    low_life_expectancy: {
      suppress: true,
    },
    infrastructure_crisis: {
      suppress: true,
    },
  },
  hazardGroups: {
    coastal: ["NORTE", "NORDESTE", "SUDESTE", "SUL"],
    flood: ["NORTE", "SUDESTE", "SUL"],
    arid: ["NORDESTE"],
    wildfire: ["CENTRO_OESTE", "NORTE"],
  },
  demographicCategoryIds: ["br_voterGroups"],
};
