import {
  JP_ADJACENCY_MAP,
  JP_CONTINENT,
  JP_CORE5_NORMALS,
  JP_INCOME_ANCHORS,
  JP_ISO_NUMERIC,
} from "./geographyFacts";
import type { ConscriptionPolicy } from "@/lib/demographics/conscription";
import type { CountryModifierPatch } from "@/lib/states/conditions/countryPatches";
import type { CountryMapConfig } from "@/lib/commodity-map/commodityMapRegistry";
import type { CountryGeography } from "../contract";
import { JP_REGIONS } from "@/lib/countries/jp/data/jpRegionDirectory";
import { jpRegionCensusData } from "@/lib/countries/jp/data/jpRegionCensusData";
import { jpRegionCensusData1953 } from "@/lib/countries/jp/data/jpRegionCensusData1953";
import { jpRegionCensusData1979 } from "@/lib/countries/jp/data/jpRegionCensusData1979";
import { jpRegionCensusData1991 } from "@/lib/countries/jp/data/jpRegionCensusData1991";
import { jpRegionCensusData2027 } from "@/lib/countries/jp/data/jpRegionCensusData2027";
import { jpMetricPresets2019 } from "@/lib/countries/jp/data/jpMetricPresets";
import { jpMetricPresets1953 } from "@/lib/countries/jp/data/jpMetricPresets1953";
import { jpMetricPresets1979 } from "@/lib/countries/jp/data/jpMetricPresets1979";
import { jpMetricPresets1991 } from "@/lib/countries/jp/data/jpMetricPresets";
import { jpRegions } from "@/lib/countries/jp/data/jpRegions";
import { jpRegions1953 } from "@/lib/countries/jp/data/jpRegions1953";
import { jpRegions1979 } from "@/lib/countries/jp/data/jpRegions1979";
import { jpRegions1991 } from "@/lib/countries/jp/data/jpRegions1991";
import { jpRegions1999 } from "@/lib/countries/jp/data/jpRegions1999";
import { jpRegions2007 } from "@/lib/countries/jp/data/jpRegions2007";
import { jpRegions2023 } from "@/lib/countries/jp/data/jpRegions2023";
import {
  jpPopulationAnchors2019,
  jpPopulationAnchors1991,
} from "@/lib/countries/jp/data/jpPopulationAnchors";
import { jpStateMetrics } from "@/lib/countries/jp/data/jpStateMetrics";

/**
 * Japan's geography, regions and demographics. Phase D5.
 *
 * ⚠️ GENERATED FROM THE PRE-MOVE SNAPSHOT. The bulk payloads live in data/
 * because four of them total roughly 6,000 lines.
 *
 * ⚠️ THE BULK REGISTRIES HOLD REFERENCES, NOT COPIES. The originals were maps of
 * MODULE REFERENCES -- `{ "1979-default": jpRegionCensusData1979, ... }` -- and
 * an early draft of this file embedded generated copies of their contents
 * instead. Deep equality passed and preset1979Bundles.test.ts still failed,
 * because it asserts IDENTITY with `toBe` to prove the 1979 lookup is not an
 * alias of the 2019 record. Copying also duplicated ~6,000 lines of authored
 * seed data, giving Japan two sources for every census and metric bundle.
 *
 * Referencing the authored modules keeps identity, keeps one source, and needs
 * no size-cap exemption. Those modules live in seeds/jp/ and D6 relocates them.
 *
 * ⚠️ CORE5_NORMALS IS NOT HERE. It is METRIC-first, not country-first:
 * `CORE5_NORMALS["gdpGrowth"]` holds one entry per country PLUS a `global`
 * pseudo-country that is a shared fallback and must not move. There is no
 * `CORE5_NORMALS.JP` to read, and moving the metric keys would take every other
 * country's values with them. Its Japan slices are forwarded per metric instead.
 *
 * ⚠️ POPULATION_MULTIPLIERS forwards WITHOUT its const being exported. Seven
 * country seeders destructure `applyEra1991DemographicAdjustments` out of a
 * ternary that unions the whole module type with a stub, so adding any export to
 * that module collapses the seeded value to `unknown`. Forwarding the JP entry
 * only adds an import, which does not change the module's export shape.
 *
 * ⚠️ The ISO pair moves together. `COUNTRY_TO_ISO_NUMERIC` and its exported
 * inverse `ISO_NUMERIC_TO_COUNTRY` are two halves of one fact; splitting them
 * gives the halves separate homes and lets them drift.
 */

/** Japan's eight regions and their neighbours. */

/**
 * ⚠ DERIVED, NOT REPEATED. This used to spell out all eight names while
 * `JP_REGIONS` in the region directory spelled out the same eight. The values
 * agreed and nothing kept them agreeing -- a second source in the state that
 * looks fine until one side is edited. The directory is the richer record (it
 * also carries each region's prefectures), so it is the one that holds the name.
 */
const regionNames: Record<string, string> = Object.fromEntries(
  JP_REGIONS.map((region) => [region.id, region.name])
);

const demographicCategoryIds: string[] = ["jp_voterGroups"];

/** ⚠️ Cast: eligibleBand is a [number, number] TUPLE and JSON cannot express that. */
const conscription = {
  eligibleBand: [18, 20],
  sexEnabled: {
    male: true,
    female: false,
  },
  option: 2,
} as ConscriptionPolicy;

/** 1991-era cohort multipliers. See the export warning above. */
const populationMultipliers: Record<string, number> = {
  salaryman_conservative: 1.15,
  urban_progressive: 0.85,
  rural_traditionalist: 1.1,
  young_urban: 1.15,
  retiree: 0.7,
  komeito_faithful: 1.2,
  reform_populist: 0,
  working_mothers: 0.5,
};

/** Reference maps, matching the originals. See the identity warning above. */
const censusBundles = {
  "1953-default": jpRegionCensusData1953,
  "1979-default": jpRegionCensusData1979,
  "2019-default": jpRegionCensusData,
  "1991-default": jpRegionCensusData1991,
  "2027-default": jpRegionCensusData2027,
};

const metricPresets = {
  "2019-default": jpMetricPresets2019,
  "1991-default": jpMetricPresets1991,
  "1979-default": jpMetricPresets1979,
  "1953-default": jpMetricPresets1953,
};

const regionBundles = {
  "1953-default": jpRegions1953,
  "1979-default": jpRegions1979,
  "1991-default": jpRegions1991,
  "1999-default": jpRegions1999,
  "2007-default": jpRegions2007,
  "2019-default": jpRegions,
  "2023-default": jpRegions2023,
};

const populationAnchors = {
  "2019-default": jpPopulationAnchors2019,
  "1991-default": jpPopulationAnchors1991,
};

const calibrationTargets = {
  "1979": {
    center: 0,
    centerTol: 0.7,
    minSpread: 1.2,
    expectLeft: ["KAN", "KNS"],
    expectRight: ["TOH", "SHI"],
    election: "Japan 1979 HR (urban opposition vs rural LDP — low confidence)",
    twoAxis: {
      minEconomicSpread: 0.6,
      minSocialSpread: 1.2,
      economicCenterTol: 0.35,
    },
  },
  "1991": {
    center: 0,
    centerTol: 0.7,
    minSpread: 1.2,
    expectLeft: ["KAN", "KNS"],
    expectRight: ["TOH", "SHI"],
    election: "Japan 1990 HR (low confidence)",
    twoAxis: {
      minEconomicSpread: 0.6,
      minSocialSpread: 1.2,
      economicCenterTol: 0.35,
    },
  },
  "1999": {
    center: 0,
    centerTol: 0.7,
    minSpread: 1.2,
    expectLeft: ["KAN", "KNS"],
    expectRight: ["TOH", "SHI"],
    election: "Japan 2000 HR (low confidence)",
    twoAxis: {
      minEconomicSpread: 0.6,
      minSocialSpread: 1.2,
      economicCenterTol: 0.35,
    },
  },
  "2007": {
    center: 0,
    centerTol: 0.7,
    minSpread: 1.2,
    expectLeft: ["KAN", "KNS"],
    expectRight: ["TOH", "SHI"],
    election: "Japan 2009 HR (DPJ win; urban left — low confidence)",
    twoAxis: {
      minEconomicSpread: 0.6,
      minSocialSpread: 1.2,
      economicCenterTol: 0.35,
    },
  },
  "2019": {
    center: 0,
    centerTol: 0.7,
    minSpread: 1.2,
    expectLeft: ["KAN", "KNS"],
    expectRight: ["TOH", "SHI"],
    election: "Japan 2017 HR (low confidence)",
    twoAxis: {
      minEconomicSpread: 0.6,
      minSocialSpread: 1.2,
      economicCenterTol: 0.35,
    },
  },
  "2023": {
    center: 0,
    centerTol: 0.7,
    minSpread: 1.2,
    expectLeft: ["KAN", "KNS"],
    expectRight: ["TOH", "SHI"],
    election: "Japan 2021 HR (low confidence)",
    twoAxis: {
      minEconomicSpread: 0.6,
      minSocialSpread: 1.2,
      economicCenterTol: 0.35,
    },
  },
  "2027": {
    center: 0,
    centerTol: 0.7,
    minSpread: 1.2,
    expectLeft: ["KAN", "KNS"],
    expectRight: ["TOH", "SHI"],
    election: "Japan 2026 House of Representatives",
    twoAxis: {
      minEconomicSpread: 0.6,
      minSocialSpread: 1.2,
      economicCenterTol: 0.35,
    },
  },
};

/** ⚠️ Cast: the condition op/category fields are literal unions JSON widens. */
const era1991Patches = {
  housing_stress: {
    conditions: [
      {
        category: "social",
        metric: "housingAffordability",
        op: ">=",
        value: 90,
      },
    ],
  },
  affordable_housing: {
    conditions: [
      {
        category: "social",
        metric: "housingAffordability",
        op: "<=",
        value: 79,
      },
    ],
  },
  free_press: {
    conditions: [
      {
        category: "mediaInformation",
        metric: "pressFreedom",
        op: ">=",
        value: 84,
      },
    ],
  },
  slow_growth: {
    conditions: [
      {
        category: "economic",
        metric: "gdpGrowth",
        op: "<=",
        value: -1.5,
      },
    ],
  },
  research_hub: {
    suppress: true,
  },
  affordable_living: {
    conditions: [
      {
        category: "economic",
        metric: "costOfLiving",
        op: "<=",
        value: 48,
      },
    ],
  },
} as Record<string, CountryModifierPatch>;

const hazardGroups = {
  coastal: ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"],
  seismic: ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"],
  volcanic: ["HOK", "TOH", "KAN", "CHU", "KNS", "KYU"],
  flood: ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"],
  wintry: ["HOK", "TOH", "CHU"],
};

/** ⚠️ Cast: projectionCenter and similar fields are tuples, not number[]. */
const mapRegistry = {
  countryId: "JP",
  name: "Japan",
  overviewPath: "/country/jp",
  mapPath: "/country/jp/map",
  hasRegionMap: true,
  geoUrl: "https://cdn.jsdelivr.net/gh/dataofjapan/land@master/japan.geojson",
  featureIdToStateId: {
    "1": "HOK",
    "2": "TOH",
    "3": "TOH",
    "4": "TOH",
    "5": "TOH",
    "6": "TOH",
    "7": "TOH",
    "8": "KAN",
    "9": "KAN",
    "10": "KAN",
    "11": "KAN",
    "12": "KAN",
    "13": "KAN",
    "14": "KAN",
    "15": "CHU",
    "16": "CHU",
    "17": "CHU",
    "18": "CHU",
    "19": "CHU",
    "20": "CHU",
    "21": "CHU",
    "22": "CHU",
    "23": "CHU",
    "24": "KNS",
    "25": "KNS",
    "26": "KNS",
    "27": "KNS",
    "28": "KNS",
    "29": "KNS",
    "30": "KNS",
    "31": "CGK",
    "32": "CGK",
    "33": "CGK",
    "34": "CGK",
    "35": "CGK",
    "36": "SHI",
    "37": "SHI",
    "38": "SHI",
    "39": "SHI",
    "40": "KYU",
    "41": "KYU",
    "42": "KYU",
    "43": "KYU",
    "44": "KYU",
    "45": "KYU",
    "46": "KYU",
    "47": "KYU",
  },
  projection: "mercator",
  projectionCenter: [136, 36],
  projectionScale: 1300,
} as CountryMapConfig;

/**
 * ⚠️ METRIC-FIRST. CORE5_NORMALS is keyed by metric, then by country, and each
 * metric also carries a `global` pseudo-country used as a shared fallback. There
 * is no CORE5_NORMALS.JP to read: these are Japan's slices lifted out per
 * metric, and `global` stays where it is because it belongs to everyone.
 */

import { JP_MODIFIER_PATCHES } from "@/lib/countries/jp/data/jpModifierPatches";

export const JP_GEOGRAPHY: CountryGeography = {
  continent: JP_CONTINENT,
  isoNumeric: JP_ISO_NUMERIC,
  unMemberSince: 1956,
  worldRegion: "asia",
  nppCapitalState: "KAN",
  nonPartyIndependentBias: 1.5,
  adjacency: JP_ADJACENCY_MAP,
  regionNames,
  demographicCategoryIds,
  conscription,
  populationMultipliers,
  populationAnchors,
  incomeAnchors: JP_INCOME_ANCHORS,
  calibrationTargets,
  modifierPatches: JP_MODIFIER_PATCHES,
  era1991Patches,
  hazardGroups,
  mapRegistry,
  core5Normals: JP_CORE5_NORMALS,
  regionBundles,
  censusBundles,
  metricPresets,
  rawMetrics: jpStateMetrics,
};

/**
 * Re-exported from `./geographyFacts`, which holds them in a module with no
 * value imports so client-reachable registries can read them without pulling
 * this module's region and census datasets into the browser bundle.
 */
export {
  JP_ADJACENCY_MAP,
  JP_CONTINENT,
  JP_CORE5_NORMALS,
  JP_INCOME_ANCHORS,
  JP_ISO_NUMERIC,
  JP_MAP_ANCHOR,
  JP_STRENGTH_REGION_COUNT,
} from "./geographyFacts";
