import type { CountryModifierPatch } from "@/lib/states/conditions/countryPatches";
import { condition as c } from "@/lib/states/conditions/condition";
import type { CountryGeography } from "../contract";
import { ngMetricPresets1953 } from "./data/ngMetricPresets1953";
import { ngMetricPresets1991, ngMetricPresets2019 } from "./data/ngMetricPresets";
import { ngRegionCensusData } from "@/lib/seeds/ng/ngRegionCensusData";
import { ngRegionCensusData1953 } from "@/lib/seeds/ng/ngRegionCensusData1953";
import { ngRegionCensusData1979 } from "@/lib/seeds/ng/ngRegionCensusData1979";
import { ngRegions } from "./data/ngRegions";
import { ngRegions1953 } from "./data/ngRegions1953";
import { ngRegions1979 } from "./data/ngRegions1979";
import { ngRegions1991 } from "./data/ngRegions1991";
import { ngRegions1999 } from "./data/ngRegions1999";
import { ngRegions2007 } from "./data/ngRegions2007";
import { ngRegions2023 } from "./data/ngRegions2023";
import { ngStateMetrics } from "./data/ngStateMetrics";
import {
  NG_ADJACENCY_MAP,
  NG_INCOME_ANCHORS,
  NG_CONSCRIPTION,
  NG_CONTINENT,
  NG_CORE5_NORMALS,
  NG_ISO_NUMERIC,
  NG_MAP_REGISTRY,
  NG_NPP_CAPITAL_STATE,
  NG_UN_MEMBER_SINCE,
  NG_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Nigeria is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. Nigeria authors 4 census
 * eras, 3 metric eras, 0 anchor eras and 7 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  ngRegions2023.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": ngRegionCensusData1953,
  "1979-default": ngRegionCensusData1979,
  "1991-default": ngRegionCensusData,
  "2019-default": ngRegionCensusData,
};

const metricPresetBundles = {
  "2019-default": ngMetricPresets2019,
  "1991-default": ngMetricPresets1991,
  "1953-default": ngMetricPresets1953,
};

const populationAnchors = {};

const regionBundles = {
  "1953-default": ngRegions1953,
  "1979-default": ngRegions1979,
  "1991-default": ngRegions1991,
  "1999-default": ngRegions1999,
  "2007-default": ngRegions2007,
  "2019-default": ngRegions,
  "2023-default": ngRegions2023,
};

/** Base-era per-modifier threshold overrides and suppressions. */
const modifierPatches: Record<string, CountryModifierPatch> = {
  // Crisis baselines are high nationally — suppress flat metrics, keep spread.
  universal_healthcare: { suppress: true },
  crime_wave: { suppress: true },
  high_violent_crime: { suppress: true },
  poor_air_quality: { suppress: true },
  corruption_concerns: { suppress: true },
  high_corruption: { suppress: true },
  low_public_trust: { suppress: true },
  government_deficit: { suppress: true },
  fiscal_crisis: { suppress: true },
  information_disorder: { suppress: true },
  media_polarization: { suppress: true },
  free_press: { suppress: true },
  low_broadband: { suppress: true },
  healthcare_crisis: { suppress: true },
  high_preventable_mortality: { suppress: true },
  weak_healthcare_capacity: { suppress: true },
  low_life_expectancy: { suppress: true },
  high_unemployment: { suppress: true },
  skills_gap: { suppress: true },
  infrastructure_crisis: { suppress: true },
  high_poverty: { conditions: [c("economic", "povertyRate", ">=", 50)] },
  low_poverty: { conditions: [c("economic", "povertyRate", "<=", 30)] },
  housing_stress: { conditions: [c("social", "housingAffordability", ">=", 58)] },
  affordable_housing: { conditions: [c("social", "housingAffordability", "<=", 48)] },
  research_hub: { conditions: [c("economic", "rdIntensity", ">=", 0.28)] },
  strong_growth: { conditions: [c("economic", "gdpGrowth", ">=", 3.8)] },
  slow_growth: { conditions: [c("economic", "gdpGrowth", "<=", 2.2)] },
  food_insecurity: { suppress: true },
  low_social_mobility: { suppress: true },
  income_inequality: { suppress: true },
  social_breakdown: { suppress: true },
  youth_surge: { suppress: true },
};

export const NG_GEOGRAPHY: CountryGeography = {
  modifierPatches,
  continent: NG_CONTINENT,

  isoNumeric: NG_ISO_NUMERIC,
  unMemberSince: NG_UN_MEMBER_SINCE,
  worldRegion: NG_WORLD_REGION,
  nppCapitalState: NG_NPP_CAPITAL_STATE,
  conscription: NG_CONSCRIPTION,
  core5Normals: NG_CORE5_NORMALS,
  adjacency: NG_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: ngStateMetrics,
  mapRegistry: NG_MAP_REGISTRY,
  incomeAnchors: NG_INCOME_ANCHORS,
};
