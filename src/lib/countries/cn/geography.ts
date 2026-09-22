import type { CountryModifierPatch } from "@/lib/states/conditions/countryPatches";
import { condition as c } from "@/lib/states/conditions/condition";
import type { CountryGeography } from "../contract";
import { cnMetricPresets1953 } from "./data/cnMetricPresets1953";
import { cnMetricPresets1979 } from "./data/cnMetricPresets1979";
import { cnMetricPresets1991, cnMetricPresets2019 } from "./data/cnMetricPresets";
import { cnPopulationAnchors1991, cnPopulationAnchors2019 } from "./data/cnPopulationAnchors";
import { cnRegionCensusData } from "./data/cnRegionCensusData";
import { cnRegionCensusData1953 } from "./data/cnRegionCensusData1953";
import { cnRegionCensusData1979 } from "./data/cnRegionCensusData1979";
import { cnRegionCensusData1991 } from "./data/cnRegionCensusData1991";
import { cnRegionCensusData2027 } from "./data/cnRegionCensusData2027";
import { cnRegions } from "./data/cnRegions";
import { cnRegions1953 } from "./data/cnRegions1953";
import { cnRegions1979 } from "./data/cnRegions1979";
import { cnRegions1991 } from "./data/cnRegions1991";
import { cnRegions1999 } from "./data/cnRegions1999";
import { cnRegions2007 } from "./data/cnRegions2007";
import { cnRegions2023 } from "./data/cnRegions2023";
import { cnStateMetrics } from "./data/cnStateMetrics";
import {
  CN_ADJACENCY_MAP,
  CN_INCOME_ANCHORS,
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

/** Base-era per-modifier threshold overrides and suppressions. */
const modifierPatches: Record<string, CountryModifierPatch> = {
  low_poverty: { suppress: true },
  universal_healthcare: { suppress: true },
  safe_streets: { suppress: true },
  falling_crime: { suppress: true },
  low_recidivism: { suppress: true },
  crime_wave: { suppress: true },
  high_violent_crime: { suppress: true },
  poor_air_quality: { suppress: true },
  corruption_concerns: { suppress: true },
  high_corruption: { suppress: true },
  high_public_trust: { suppress: true },
  high_voter_turnout: { suppress: true },
  social_cohesion: { suppress: true },
  strong_safety_net: { suppress: true },
  civic_flourishing: { suppress: true },
  declining_population: { suppress: true },
  government_deficit: { suppress: true },
  press_suppression: { suppress: true },
  informed_society: { suppress: true },
  free_press: { suppress: true },
  strong_growth: { conditions: [c("economic", "gdpGrowth", ">=", 6.0)] },
  slow_growth: { conditions: [c("economic", "gdpGrowth", "<=", 3.5)] },
  housing_stress: { conditions: [c("social", "housingAffordability", ">=", 82)] },
  affordable_housing: { conditions: [c("social", "housingAffordability", "<=", 62)] },
  research_hub: { conditions: [c("economic", "rdIntensity", ">=", 3.3)] },
  green_transition: { conditions: [c("environment", "renewableEnergy", ">=", 45)] },
  heavy_public_debt: { conditions: [c("governance", "debtToGdp", ">=", 90)] },
  low_social_mobility: { suppress: true },
  high_social_mobility: { conditions: [c("social", "socialMobility", ">=", 82)] },
  high_broadband: { suppress: true },
  low_broadband: { suppress: true },
  infrastructure_boom: { suppress: true },
  infrastructure_crisis: { suppress: true },
  educated_workforce: {
    conditions: [
      c("education", "highSchoolGradRate", ">=", 92),
      c("education", "workforceSkill", ">=", 78),
    ],
  },
};

export const CN_GEOGRAPHY: CountryGeography = {
  continent: CN_CONTINENT,

  isoNumeric: CN_ISO_NUMERIC,
  unMemberSince: CN_UN_MEMBER_SINCE,
  worldRegion: CN_WORLD_REGION,
  nppCapitalState: CN_NPP_CAPITAL_STATE,
  conscription: CN_CONSCRIPTION,
  populationMultipliers: CN_POPULATION_MULTIPLIERS,
  core5Normals: CN_CORE5_NORMALS,
  adjacency: CN_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: cnStateMetrics,
  mapRegistry: CN_MAP_REGISTRY,
  incomeAnchors: CN_INCOME_ANCHORS,
  modifierPatches: modifierPatches,
  era1991Patches: {
    affordable_housing: {
      suppress: true,
    },
    low_life_expectancy: {
      suppress: true,
    },
    strong_growth: {
      conditions: [
        {
          category: "economic",
          metric: "gdpGrowth",
          op: ">=",
          value: 4.5,
        },
      ],
    },
    slow_growth: {
      suppress: true,
    },
    research_hub: {
      suppress: true,
    },
    heavy_public_debt: {
      suppress: true,
    },
    low_social_mobility: {
      suppress: true,
    },
    informed_society: {
      conditions: [
        {
          category: "mediaInformation",
          metric: "newsTrust",
          op: ">=",
          value: 68,
        },
        {
          category: "mediaInformation",
          metric: "mediaPolarization",
          op: "<=",
          value: 32,
        },
      ],
    },
  },
  hazardGroups: {
    coastal: ["DB", "HB", "HD", "HN"],
    seismic: ["XN", "XB"],
    flood: ["HD", "HZ", "HN", "DB"],
    wintry: ["DB", "XB", "HB"],
    arid: ["XB", "HB"],
  },
  demographicCategoryIds: ["cn_voterGroups"],
};
