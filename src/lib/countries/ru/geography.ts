import type { CountryGeography } from "../contract";
import { ruMetricPresets1953 } from "./data/ruMetricPresets1953";
import { ruRegionCensusData } from "./data/ruRegionCensusData";
import { ruRegionCensusData1953 } from "./data/ruRegionCensusData1953";
import { ruRegions } from "./data/ruRegions";
import { ruRegions1953 } from "./data/ruRegions1953";
import { ruRegions2027 } from "./data/ruRegions2027";
import { ruStateMetrics } from "./data/ruStateMetrics";
import {
  RU_ADJACENCY_MAP,
  RU_INCOME_ANCHORS,
  RU_CONTINENT,
  RU_ISO_NUMERIC,
  RU_MAP_REGISTRY,
  RU_NPP_CAPITAL_STATE,
  RU_UN_MEMBER_SINCE,
  RU_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where Russia is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT, plus the authored 2027
 * Russian Federation substrate. Russia authors 2 census
 * eras, 1 metric eras, 0 anchor eras and 4 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  ruRegions.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": ruRegionCensusData1953,
  "1979-default": ruRegionCensusData,
};

const metricPresetBundles = {
  "1953-default": ruMetricPresets1953,
};

const populationAnchors = {};

const regionBundles = {
  "1953-default": ruRegions1953,
  "1979-default": ruRegions,
  "2019-default": ruRegions,
  "2027-default": ruRegions2027,
};

export const RU_GEOGRAPHY: CountryGeography = {
  continent: RU_CONTINENT,

  isoNumeric: RU_ISO_NUMERIC,
  unMemberSince: RU_UN_MEMBER_SINCE,
  worldRegion: RU_WORLD_REGION,
  nppCapitalState: RU_NPP_CAPITAL_STATE,
  adjacency: RU_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: ruStateMetrics,
  mapRegistry: RU_MAP_REGISTRY,
  incomeAnchors: RU_INCOME_ANCHORS,
  calibrationTargets: {
    "1953": {
      center: 0,
      centerTol: 5,
      minSpread: 0,
      expectLeft: [],
      expectRight: [],
      election:
        "USSR 1953 — command economy; no competitive vote. Guards regional variation, not left/right.",
      twoAxis: {
        economicCenter: -2,
        economicCenterTol: 0.6,
        minEconomicSpread: 0.4,
        minSocialSpread: 0.7,
      },
    },
  },
};
