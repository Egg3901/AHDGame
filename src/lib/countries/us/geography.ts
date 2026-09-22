import type { CountryGeography } from "../contract";
import { stateCensusData } from "./data/usStateCensusData";
import { stateCensusData1953 } from "./data/usStateCensusData1953";
import { stateCensusData1979 } from "./data/usStateCensusData1979";
import { stateCensusData1991 } from "./data/usStateCensusData1991";
import { stateCensusData1999 } from "./data/usStateCensusData1999";
import { stateCensusData2007 } from "./data/usStateCensusData2007";
import { stateCensusData2023 } from "./data/usStateCensusData2023";
import { stateCensusData2027 } from "./data/usStateCensusData2027";
import { stateMetrics } from "./data/usStateMetrics";
import { states } from "./data/usStates";
import { states1953 } from "./data/usStates1953";
import { states1979 } from "./data/usStates1979";
import { states1991 } from "./data/usStates1991";
import { states1999 } from "./data/usStates1999";
import { states2007 } from "./data/usStates2007";
import { states2023 } from "./data/usStates2023";
import { states2027 } from "./data/usStates2027";
import { usMetricPresets1953 } from "./data/usMetricPresets1953";
import { usMetricPresets1991, usMetricPresets2019 } from "./data/usMetricPresets";
import { usPopulationAnchors1991, usPopulationAnchors2019 } from "./data/usPopulationAnchors";
import {
  US_ADJACENCY_MAP,
  US_INCOME_ANCHORS,
  US_CONSCRIPTION,
  US_CONTINENT,
  US_CORE5_NORMALS,
  US_ISO_NUMERIC,
  US_MAP_REGISTRY,
  US_NON_PARTY_INDEPENDENT_BIAS,
  US_NPP_CAPITAL_STATE,
  US_POPULATION_MULTIPLIERS,
  US_UN_MEMBER_SINCE,
  US_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where the United States is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. the United States authors 8 census
 * eras, 3 metric eras, 2 anchor eras and 8 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  states2027.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": stateCensusData1953,
  "1979-default": stateCensusData1979,
  "1991-default": stateCensusData1991,
  "1999-default": stateCensusData1999,
  "2007-default": stateCensusData2007,
  "2019-default": stateCensusData,
  "2023-default": stateCensusData2023,
  "2027-default": stateCensusData2027,
};

const metricPresetBundles = {
  "2019-default": usMetricPresets2019,
  "1991-default": usMetricPresets1991,
  "1953-default": usMetricPresets1953,
};

const populationAnchors = {
  "2019-default": usPopulationAnchors2019,
  "1991-default": usPopulationAnchors1991,
};

const regionBundles = {
  "1953-default": states1953,
  "1979-default": states1979,
  "1991-default": states1991,
  "1999-default": states1999,
  "2007-default": states2007,
  "2019-default": states,
  "2023-default": states2023,
  "2027-default": states2027,
};

export const US_GEOGRAPHY: CountryGeography = {
  continent: US_CONTINENT,

  isoNumeric: US_ISO_NUMERIC,
  unMemberSince: US_UN_MEMBER_SINCE,
  worldRegion: US_WORLD_REGION,
  nppCapitalState: US_NPP_CAPITAL_STATE,
  nonPartyIndependentBias: US_NON_PARTY_INDEPENDENT_BIAS,
  conscription: US_CONSCRIPTION,
  populationMultipliers: US_POPULATION_MULTIPLIERS,
  core5Normals: US_CORE5_NORMALS,
  adjacency: US_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: stateMetrics,
  mapRegistry: US_MAP_REGISTRY,
  incomeAnchors: US_INCOME_ANCHORS,
  calibrationTargets: {
    "1979": {
      center: 0,
      centerTol: 5,
      minSpread: 0,
      expectLeft: ["DC", "GA", "WV", "MN", "MD", "RI", "HI"],
      expectRight: ["UT", "ID", "WY", "NE", "KS", "AK"],
      election: "US 1980 presidential (Reagan landslide; Carter states = left)",
      twoAxis: {
        economicCenter: 0.35,
        economicCenterTol: 0.5,
        minEconomicSpread: 2.4,
        minSocialSpread: 2.4,
      },
    },
    "1991": {
      center: 0,
      centerTol: 5,
      minSpread: 0,
      expectLeft: ["DC", "MA", "RI", "NY", "MD", "HI", "MN", "IL"],
      expectRight: ["UT", "ID", "WY", "NE", "KS", "AK", "OK", "SC", "IN"],
      ordering: [
        ["MA", "TX"],
        ["NY", "WY"],
      ],
      election: "US 1992 presidential, by state (ideology-adjusted for WV/AR)",
      twoAxis: {
        economicCenter: 0.15,
        economicCenterTol: 0.5,
        minEconomicSpread: 3.2,
        minSocialSpread: 3.4,
      },
    },
    "1999": {
      center: 0,
      centerTol: 5,
      minSpread: 0,
      expectLeft: ["DC", "MA", "RI"],
      expectRight: ["WY", "ID", "UT", "AK", "NE", "KS", "OK", "TX", "AL", "MS", "ND", "SD"],
      ordering: [
        ["MA", "TX"],
        ["NY", "WY"],
      ],
      election: "US 2000 presidential, by state",
      twoAxis: {
        economicCenter: 0.9,
        economicCenterTol: 0.5,
        minEconomicSpread: 2.2,
        minSocialSpread: 2.6,
      },
    },
    "2007": {
      center: 0,
      centerTol: 5,
      minSpread: 0,
      expectLeft: ["DC", "HI", "VT", "MA", "RI", "NY", "MD", "IL", "CA"],
      expectRight: ["WY", "OK", "ID", "UT", "AL", "AR", "LA", "KY", "TN", "NE", "KS", "WV"],
      ordering: [
        ["MA", "TX"],
        ["CA", "AL"],
      ],
      election: "US 2008 presidential, by state",
      twoAxis: {
        economicCenter: 0.05,
        economicCenterTol: 0.5,
        minEconomicSpread: 2.4,
        minSocialSpread: 2.9,
      },
    },
    "2019": {
      center: 0,
      centerTol: 0.6,
      minSpread: 2.5,
      expectLeft: ["CA", "NY", "MA", "MD", "HI", "WA", "VT", "IL", "DC", "NJ"],
      expectRight: ["WY", "WV", "OK", "ND", "ID", "AL", "AR", "KY", "SD", "TN"],
      ordering: [
        ["MA", "TX"],
        ["CA", "AL"],
        ["NY", "WY"],
      ],
      election: "US 2020 presidential, by state",
    },
    "2023": {
      center: 0,
      centerTol: 0.6,
      minSpread: 2.5,
      expectLeft: ["DC", "HI", "MA", "MD", "VT", "CA", "NY", "WA", "IL", "NJ", "CT", "RI"],
      expectRight: ["WY", "WV", "ND", "ID", "OK", "AR", "AL", "KY", "SD", "TN", "MS", "MT"],
      ordering: [
        ["MA", "TX"],
        ["CA", "AL"],
      ],
      election: "US 2024 presidential, by state",
    },
    "2027": {
      center: 0,
      centerTol: 0.6,
      minSpread: 2.5,
      expectLeft: ["DC", "HI", "MA", "MD", "VT", "CA", "NY", "WA", "IL", "NJ", "CT", "RI"],
      expectRight: ["WY", "WV", "ND", "ID", "OK", "AR", "AL", "KY", "SD", "TN", "MS", "MT"],
      ordering: [
        ["MA", "TX"],
        ["CA", "AL"],
      ],
      election: "US 2024 presidential, by state",
    },
  },
  era1991Patches: {
    affordable_housing: {
      conditions: [
        {
          category: "social",
          metric: "housingAffordability",
          op: "<=",
          value: 38,
        },
      ],
    },
    corruption_concerns: {
      conditions: [
        {
          category: "governance",
          metric: "corruptionIndex",
          op: ">=",
          value: 56,
        },
      ],
    },
    information_disorder: {
      suppress: true,
    },
    media_polarization: {
      suppress: true,
    },
  },
  hazardGroups: {
    coastal: [
      "AK",
      "CA",
      "OR",
      "WA",
      "HI",
      "TX",
      "LA",
      "MS",
      "AL",
      "FL",
      "GA",
      "SC",
      "NC",
      "VA",
      "MD",
      "DE",
      "NJ",
      "NY",
      "CT",
      "RI",
      "MA",
      "NH",
      "ME",
    ],
    seismic: ["CA", "AK", "NV", "WA", "OR", "HI", "UT"],
    tornado: [
      "TX",
      "OK",
      "KS",
      "NE",
      "SD",
      "IA",
      "MO",
      "AR",
      "MS",
      "AL",
      "IL",
      "IN",
      "MN",
      "ND",
      "CO",
      "GA",
      "KY",
      "TN",
    ],
    volcanic: ["HI", "AK", "WA", "OR", "CA"],
    flood: [
      "LA",
      "MS",
      "MO",
      "IA",
      "IL",
      "TX",
      "FL",
      "ND",
      "KY",
      "TN",
      "WV",
      "CA",
      "NJ",
      "NY",
      "PA",
    ],
    wintry: [
      "AK",
      "ME",
      "NH",
      "VT",
      "NY",
      "MA",
      "CT",
      "RI",
      "MI",
      "MN",
      "WI",
      "ND",
      "SD",
      "MT",
      "WY",
      "CO",
      "IA",
      "PA",
      "OH",
      "IL",
      "IN",
    ],
    wildfire: ["CA", "OR", "WA", "NV", "AZ", "NM", "CO", "MT", "ID", "UT", "TX"],
    arid: ["AZ", "NM", "NV", "UT", "CA", "TX", "OK", "KS", "CO"],
  },
};
