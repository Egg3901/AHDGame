import type { CountryModifierPatch } from "@/lib/states/conditions/countryPatches";
import { condition as c } from "@/lib/states/conditions/condition";
import type { CountryGeography } from "../contract";
import { deMetricPresets1953 } from "./data/deMetricPresets1953";
import { deMetricPresets1979 } from "./data/deMetricPresets1979";
import { deMetricPresets1991, deMetricPresets2019 } from "./data/deMetricPresets";
import { dePopulationAnchors1991, dePopulationAnchors2019 } from "./data/dePopulationAnchors";
import { deRegionCensusData } from "./data/deRegionCensusData";
import { deRegionCensusData1953 } from "./data/deRegionCensusData1953";
import { deRegionCensusData1979 } from "./data/deRegionCensusData1979";
import { deRegionCensusData1991 } from "./data/deRegionCensusData1991";
import { deRegionCensusData2027 } from "./data/deRegionCensusData2027";
import { deRegions } from "./data/deRegions";
import { deRegions1953 } from "./data/deRegions1953";
import { deRegions1979 } from "./data/deRegions1979";
import { deRegions1991 } from "./data/deRegions1991";
import { deRegions1999 } from "./data/deRegions1999";
import { deRegions2007 } from "./data/deRegions2007";
import { deRegions2023 } from "./data/deRegions2023";
import { deStateMetrics } from "./data/deStateMetrics";
import {
  DE_ADJACENCY_MAP,
  DE_INCOME_ANCHORS,
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

/** Base-era per-modifier threshold overrides and suppressions. */
const modifierPatches: Record<string, CountryModifierPatch> = {
  universal_healthcare: { suppress: true },
  safe_streets: { suppress: true },
  falling_crime: { suppress: true },
  high_broadband: { suppress: true },
  low_broadband: { suppress: true },
  infrastructure_boom: { suppress: true },
  free_press: { suppress: true },
  poor_air_quality: { suppress: true },
  corruption_concerns: { suppress: true },
  high_corruption: { suppress: true },
  balanced_budget: { suppress: true },
  high_voter_turnout: { suppress: true },
  good_recycling: { suppress: true },
  innovation_economy: { suppress: true },
  high_immigration: { suppress: true },
  brain_gain: { suppress: true },
  crime_wave: { suppress: true },
  high_violent_crime: { suppress: true },
  heavy_public_debt: { conditions: [c("governance", "debtToGdp", ">=", 70)] },
  high_poverty: { conditions: [c("economic", "povertyRate", ">=", 20)] },
  low_poverty: { conditions: [c("economic", "povertyRate", "<=", 14)] },
  housing_stress: { conditions: [c("social", "housingAffordability", ">=", 68)] },
  affordable_housing: { conditions: [c("social", "housingAffordability", "<=", 48)] },
  research_hub: { conditions: [c("economic", "rdIntensity", ">=", 3.5)] },
  green_transition: { conditions: [c("environment", "renewableEnergy", ">=", 75)] },
  slow_growth: { conditions: [c("economic", "gdpGrowth", "<=", 0.8)] },
  strong_growth: { conditions: [c("economic", "gdpGrowth", ">=", 1.8)] },
  government_deficit: { suppress: true },
  aging_population: { suppress: true },
};

export const DE_GEOGRAPHY: CountryGeography = {
  continent: DE_CONTINENT,

  isoNumeric: DE_ISO_NUMERIC,
  worldRegion: DE_WORLD_REGION,
  nppCapitalState: DE_NPP_CAPITAL_STATE,
  nonPartyIndependentBias: DE_NON_PARTY_INDEPENDENT_BIAS,
  conscription: DE_CONSCRIPTION,
  populationMultipliers: DE_POPULATION_MULTIPLIERS,
  core5Normals: DE_CORE5_NORMALS,
  adjacency: DE_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: deStateMetrics,
  mapRegistry: DE_MAP_REGISTRY,
  incomeAnchors: DE_INCOME_ANCHORS,
  calibrationTargets: {
    "1979": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.5,
      expectLeft: ["HH", "BRE", "NW", "SL"],
      expectRight: ["BY", "BW"],
      election: "West Germany 1980 (Schmidt SPD); West Länder only",
    },
    "1991": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.5,
      expectLeft: ["HH", "BRE", "NW"],
      expectRight: ["BY", "BW"],
      election: "Germany 1990 (first reunified; low confidence on East — review)",
    },
    "1999": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.6,
      expectLeft: ["HH", "BRE", "NW", "BB", "MV", "TH"],
      expectRight: ["BY", "BW"],
      election: "Germany 1998 (Schröder SPD win; East SPD/PDS strong)",
    },
    "2007": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.5,
      expectLeft: ["HH", "BRE", "BE"],
      expectRight: ["BY", "BW"],
      election: "Germany 2005 (grand coalition)",
    },
    "2019": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.6,
      expectLeft: ["BE", "HH", "BRE"],
      expectRight: ["BY", "BW", "SN"],
      election: "Germany 2017",
    },
    "2023": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.6,
      expectLeft: ["HH", "BRE", "BE", "BB", "MV"],
      expectRight: ["BY", "BW", "SN"],
      election: "Germany 2021 (Scholz SPD win)",
    },
    "2027": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.6,
      expectLeft: ["HH", "BRE", "BE", "BB"],
      expectRight: ["BY", "MV"],
      election: "Germany 2025 Bundestag",
    },
  },
  modifierPatches: modifierPatches,
  era1991Patches: {
    slow_growth: {
      conditions: [
        {
          category: "economic",
          metric: "gdpGrowth",
          op: "<=",
          value: -0.8,
        },
      ],
    },
    heavy_public_debt: {
      suppress: true,
    },
    high_violent_crime: {
      suppress: true,
    },
    affordable_housing: {
      conditions: [
        {
          category: "social",
          metric: "housingAffordability",
          op: "<=",
          value: 35,
        },
      ],
    },
    housing_stress: {
      conditions: [
        {
          category: "social",
          metric: "housingAffordability",
          op: ">=",
          value: 44,
        },
      ],
    },
    research_hub: {
      conditions: [
        {
          category: "economic",
          metric: "rdIntensity",
          op: ">=",
          value: 2.8,
        },
      ],
    },
  },
  hazardGroups: {
    coastal: ["SH", "HH", "BRE", "MV", "NI"],
    flood: ["NW", "RP", "BW", "BY", "SN", "ST", "BB", "NI", "SH", "HE"],
    wintry: ["BY", "BW", "SN", "TH", "ST"],
  },
  demographicCategoryIds: ["de_voterGroups"],
};
