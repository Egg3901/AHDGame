import type { CountryModifierPatch } from "@/lib/states/conditions/countryPatches";
import { condition as c } from "@/lib/states/conditions/condition";
import type { CountryGeography } from "../contract";
import { ukMetricPresets1953 } from "./data/ukMetricPresets1953";
import { ukMetricPresets1979 } from "./data/ukMetricPresets1979";
import { ukMetricPresets1991, ukMetricPresets2019 } from "./data/ukMetricPresets";
import { ukPopulationAnchors1991, ukPopulationAnchors2019 } from "./data/ukPopulationAnchors";
import { ukRegionCensusData } from "./data/ukRegionCensusData";
import { ukRegionCensusData1953 } from "./data/ukRegionCensusData1953";
import { ukRegionCensusData1979 } from "./data/ukRegionCensusData1979";
import { ukRegionCensusData1991 } from "./data/ukRegionCensusData1991";
import { ukRegionCensusData2027 } from "./data/ukRegionCensusData2027";
import { ukRegions } from "./data/ukRegions";
import { ukRegions1953 } from "./data/ukRegions1953";
import { ukRegions1979 } from "./data/ukRegions1979";
import { ukRegions1991 } from "./data/ukRegions1991";
import { ukRegions1999 } from "./data/ukRegions1999";
import { ukRegions2007 } from "./data/ukRegions2007";
import { ukRegions2023 } from "./data/ukRegions2023";
import { ukStateMetrics } from "./data/ukStateMetrics";
import {
  UK_ADJACENCY_MAP,
  UK_INCOME_ANCHORS,
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. the United Kingdom authors 5 census
 * eras, 4 metric eras, 2 anchor eras and 7 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  ukRegions2023.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": ukRegionCensusData1953,
  "1979-default": ukRegionCensusData1979,
  "2019-default": ukRegionCensusData,
  "1991-default": ukRegionCensusData1991,
  "2027-default": ukRegionCensusData2027,
};

const metricPresetBundles = {
  "2019-default": ukMetricPresets2019,
  "1991-default": ukMetricPresets1991,
  "1979-default": ukMetricPresets1979,
  "1953-default": ukMetricPresets1953,
};

const populationAnchors = {
  "2019-default": ukPopulationAnchors2019,
  "1991-default": ukPopulationAnchors1991,
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

/** Base-era per-modifier threshold overrides and suppressions. */
const modifierPatches: Record<string, CountryModifierPatch> = {
  high_poverty: { conditions: [c("economic", "povertyRate", ">=", 20)] },
  low_poverty: { conditions: [c("economic", "povertyRate", "<=", 11)] },
  crime_wave: {
    conditions: [
      c("publicSafety", "violentCrimeRate", ">=", 380),
      c("publicSafety", "publicSafetyConfidence", "<=", 52),
    ],
  },
  high_violent_crime: { conditions: [c("publicSafety", "violentCrimeRate", ">=", 400)] },
  affordable_housing: { conditions: [c("social", "housingAffordability", "<=", 8)] },
  housing_stress: { conditions: [c("social", "housingAffordability", ">=", 12)] },
  corruption_concerns: { conditions: [c("governance", "corruptionIndex", ">=", 34)] },
  free_press: { conditions: [c("mediaInformation", "pressFreedom", ">=", 80)] },
  heavy_public_debt: { conditions: [c("governance", "debtToGdp", ">=", 100)] },
  research_hub: { conditions: [c("economic", "rdIntensity", ">=", 2.0)] },
};

export const UK_GEOGRAPHY: CountryGeography = {
  continent: UK_CONTINENT,

  isoNumeric: UK_ISO_NUMERIC,
  unMemberSince: UK_UN_MEMBER_SINCE,
  worldRegion: UK_WORLD_REGION,
  nppCapitalState: UK_NPP_CAPITAL_STATE,
  nonPartyIndependentBias: UK_NON_PARTY_INDEPENDENT_BIAS,
  conscription: UK_CONSCRIPTION,
  populationMultipliers: UK_POPULATION_MULTIPLIERS,
  core5Normals: UK_CORE5_NORMALS,
  adjacency: UK_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: ukStateMetrics,
  mapRegistry: UK_MAP_REGISTRY,
  incomeAnchors: UK_INCOME_ANCHORS,
  calibrationTargets: {
    "1953": {
      center: 0,
      centerTol: 0.6,
      minSpread: 1.8,
      expectLeft: ["NEE", "NWE", "WAL", "SCO", "YHU"],
      expectRight: ["SEE", "SWE", "EAE", "EMI"],
      election:
        "UK 1951/1955 generals (near-ties; Churchill government, Labour North/Wales/Scotland)",
    },
    "1979": {
      center: 0,
      centerTol: 0.6,
      minSpread: 1.8,
      expectLeft: ["NEE", "NWE", "WAL", "SCO", "YHU"],
      expectRight: ["SEE", "SWE", "EAE", "EMI"],
      election: "UK 1979 general (North/Wales/Scotland Labour, South Conservative)",
    },
    "1991": {
      center: 0,
      centerTol: 5,
      minSpread: 0,
      expectLeft: [],
      expectRight: [],
      election: "UK 1992 general",
      twoAxis: {
        economicCenter: -1.7,
        economicCenterTol: 0.5,
        minEconomicSpread: 0.7,
        minSocialSpread: 0.05,
      },
      ordering: [
        ["LON", "SEE"],
        ["NEE", "SEE"],
        ["NWE", "SWE"],
        ["WAL", "EAE"],
      ],
    },
    "1999": {
      center: 0,
      centerTol: 5,
      minSpread: 0,
      expectLeft: [],
      expectRight: [],
      election: "UK 1997 general (Blair landslide)",
      twoAxis: {
        economicCenter: -2.05,
        economicCenterTol: 0.5,
        minEconomicSpread: 0.2,
        minSocialSpread: 0.3,
      },
      ordering: [["NEE", "SEE"]],
    },
    "2007": {
      center: 0,
      centerTol: 0.6,
      minSpread: 1.8,
      expectLeft: ["NEE", "NWE", "WAL", "SCO", "YHU", "LON"],
      expectRight: ["SEE", "SWE", "EAE"],
      election: "UK 2005 general",
    },
    "2019": {
      center: 0,
      centerTol: 0.6,
      minSpread: 1.6,
      expectLeft: ["LON"],
      expectRight: ["SEE", "SWE", "EAE"],
      election: "UK 2019 general (low confidence on Midlands/North — review)",
    },
    "2023": {
      center: 0,
      centerTol: 0.6,
      minSpread: 1.8,
      expectLeft: ["NEE", "NWE", "WAL", "LON", "YHU"],
      expectRight: ["SEE", "EAE"],
      election: "UK 2024 general (Labour landslide)",
    },
    "2027": {
      center: 0,
      centerTol: 0.6,
      minSpread: 1.8,
      expectLeft: ["NEE", "NWE", "WAL", "LON", "YHU"],
      expectRight: ["SEE", "EAE"],
      election: "UK 2024 general (Labour landslide)",
    },
  },
  modifierPatches: modifierPatches,
  era1991Patches: {
    free_press: {
      suppress: true,
    },
    slow_growth: {
      conditions: [
        {
          category: "economic",
          metric: "gdpGrowth",
          op: "<=",
          value: -0.5,
        },
      ],
    },
    affordable_housing: {
      conditions: [
        {
          category: "social",
          metric: "housingAffordability",
          op: "<=",
          value: 4.5,
        },
      ],
    },
    affordable_living: {
      conditions: [
        {
          category: "economic",
          metric: "costOfLiving",
          op: "<=",
          value: 45,
        },
      ],
    },
    heavy_public_debt: {
      suppress: true,
    },
    research_hub: {
      suppress: true,
    },
    high_violent_crime: {
      conditions: [
        {
          category: "publicSafety",
          metric: "violentCrimeRate",
          op: ">=",
          value: 500,
        },
      ],
    },
  },
  hazardGroups: {
    coastal: ["SEE", "SWE", "EAE", "YHU", "NWE", "NEE", "SCO", "WAL", "NIR"],
    flood: ["LON", "SWE", "EAE", "YHU", "NWE", "SEE", "WAL", "SCO"],
    wintry: ["SCO", "NEE", "NWE", "YHU", "NIR"],
  },
  demographicCategoryIds: ["uk_voterGroups"],
};
