import type { CountryGeography } from "../contract";
import { ddRegionCensusData } from "@/lib/seeds/dd/ddRegionCensusData";
import { ddRegionCensusData1953 } from "@/lib/seeds/dd/ddRegionCensusData1953";
import { ddRegions } from "./data/ddRegions";
import { ddRegions1953 } from "./data/ddRegions1953";
import { ddStateMetrics } from "./data/ddStateMetrics";
import {
  DD_ADJACENCY_MAP,
  DD_INCOME_ANCHORS,
  DD_CONTINENT,
  DD_ISO_NUMERIC,
  DD_MAP_REGISTRY,
  DD_NPP_CAPITAL_STATE,
  DD_WORLD_REGION,
} from "./geographyFacts";

/**
 * Where East Germany is, and who lives there.
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
 * ⚠ THE PRESET KEYS COME FROM THE SNAPSHOT. East Germany authors 2 census
 * eras, 0 metric eras, 0 anchor eras and 2 region eras. The gaps are real:
 * an unauthored era inherits, and inventing a key for it would turn a fallback
 * into an authored value.
 */

const regionNames: Record<string, string> = Object.fromEntries(
  ddRegions.map((region) => [region._id, region.name])
);

const censusBundles = {
  "1953-default": ddRegionCensusData1953,
  "1979-default": ddRegionCensusData,
};

const metricPresetBundles = {};

const populationAnchors = {};

const regionBundles = {
  "1953-default": ddRegions1953,
  "1979-default": ddRegions,
};

export const DD_GEOGRAPHY: CountryGeography = {
  continent: DD_CONTINENT,

  isoNumeric: DD_ISO_NUMERIC,
  worldRegion: DD_WORLD_REGION,
  nppCapitalState: DD_NPP_CAPITAL_STATE,
  adjacency: DD_ADJACENCY_MAP,
  regionNames,
  censusBundles,
  populationAnchors,
  metricPresets: metricPresetBundles,
  regionBundles,
  rawMetrics: ddStateMetrics,
  mapRegistry: DD_MAP_REGISTRY,
  incomeAnchors: DD_INCOME_ANCHORS,
  calibrationTargets: {
    "1953": {
      center: 0,
      centerTol: 5,
      minSpread: 0,
      expectLeft: [],
      expectRight: [],
      election:
        "DDR 1953 — post-June-17; no competitive vote. Guards regional variation, not left/right.",
      twoAxis: {
        economicCenter: -0.6,
        economicCenterTol: 0.6,
        minEconomicSpread: 0.35,
        minSocialSpread: 0.8,
      },
    },
  },
  demographicCategoryIds: ["dd_voterGroups"],
};
