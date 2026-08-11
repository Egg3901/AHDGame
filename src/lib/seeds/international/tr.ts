/**
 * Turkey (TR) Layer-1 demographic model — census-consuming (1979). Single-era.
 * Mirrors the SE/ES/IT/FR models.
 *
 * economicLean: -5 (statist/left) … +5 (market/right)
 * socialLean:   -5 (secular/Kemalist) … +5 (religious/traditional)
 *
 * 1979 anchor: a polarised pre-coup republic — a secular Kemalist establishment
 * (CHP), a religious-conservative Anatolian base (AP/MSP), Turkish nationalists
 * (MHP), an industrial working class, the rural peasantry, a marginalised Kurdish
 * population in the east/southeast, and an Istanbul business bourgeoisie.
 */
import type { CountryLayer1Model, DemographicPosition } from "./types";
import { trRegionCensusData, type TRRegionLayer1 } from "@/lib/seeds/tr/trRegionCensusData";
import { trRegionCensusData1953 } from "@/lib/seeds/tr/trRegionCensusData1953";
import type { EraId } from "@/lib/seeds/presetSelector";

export const TR_GROUP_IDS = [
  "kemalist_secular",
  "conservative_religious",
  "nationalist",
  "urban_worker",
  "rural_peasant",
  "kurdish_minority",
  "business_liberal",
] as const;

type GroupId = (typeof TR_GROUP_IDS)[number];

const TURNOUT_RATES: CountryLayer1Model["turnoutRates"] = {
  ethnicity: { turkish: 74, kurdish: 65, other: 60 },
  age: { young: 68, mid: 74, mature: 76, senior: 72 },
  education: { primary_or_below: 72, secondary: 74, vocational: 74, university: 80 },
  income: { low: 70, middle: 74, high: 78 },
  urbanization: { urban: 74, suburban: 72, rural: 72 },
};

const COMPOSITION: Record<GroupId, CountryLayer1Model["composition"][string]> = {
  kemalist_secular: {
    weights: [
      { dim: "education", key: "university", w: 0.35 },
      { dim: "urbanization", key: "urban", w: 0.25 },
      { dim: "ethnicity", key: "turkish", w: 0.2 },
      { dim: "income", key: "middle", w: 0.2 },
    ],
    civicMultiplier: 1.05,
  },
  conservative_religious: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.35 },
      { dim: "education", key: "primary_or_below", w: 0.3 },
      { dim: "age", key: "mature", w: 0.2 },
      { dim: "ethnicity", key: "turkish", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  nationalist: {
    weights: [
      { dim: "age", key: "young", w: 0.3 },
      { dim: "ethnicity", key: "turkish", w: 0.3 },
      { dim: "urbanization", key: "suburban", w: 0.2 },
      { dim: "education", key: "secondary", w: 0.2 },
    ],
    civicMultiplier: 0.95,
  },
  urban_worker: {
    weights: [
      { dim: "income", key: "low", w: 0.35 },
      { dim: "urbanization", key: "urban", w: 0.3 },
      { dim: "education", key: "vocational", w: 0.2 },
      { dim: "age", key: "mid", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  rural_peasant: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.45 },
      { dim: "income", key: "low", w: 0.3 },
      { dim: "ethnicity", key: "turkish", w: 0.15 },
      { dim: "age", key: "mature", w: 0.1 },
    ],
    civicMultiplier: 1.0,
  },
  kurdish_minority: {
    weights: [
      { dim: "ethnicity", key: "kurdish", w: 0.6 },
      { dim: "income", key: "low", w: 0.25 },
      { dim: "urbanization", key: "rural", w: 0.15 },
    ],
    civicMultiplier: 0.9,
  },
  business_liberal: {
    weights: [
      { dim: "income", key: "high", w: 0.45 },
      { dim: "education", key: "university", w: 0.2 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "age", key: "mature", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
};

const DEFAULT_LEANS: Record<GroupId, { economicLean: number; socialLean: number }> = {
  kemalist_secular: { economicLean: -1, socialLean: -3 },
  conservative_religious: { economicLean: 1, socialLean: 4 },
  nationalist: { economicLean: 1, socialLean: 3 },
  urban_worker: { economicLean: -3, socialLean: -1 },
  rural_peasant: { economicLean: 0, socialLean: 3 },
  kurdish_minority: { economicLean: -2, socialLean: 1 },
  business_liberal: { economicLean: 3, socialLean: 0 },
};

type DimPositions = Record<string, DemographicPosition>;
type EraPositions = Record<string, DimPositions>;

// 1953 — Democrat Party (Menderes) holds power after 1950 landslide over Kemalist CHP.
// Urban/secular Kemalist vs. rural/religious Democrat axis is the dominant cleavage.
// University = Kemalist establishment (secular, statist). Rural peasantry = DP
// (religious, anti-elite). Class politics underdeveloped. Kurdish identity suppressed.
// Istanbul minority (Greek/Armenian/Jewish) present but politically peripheral.
const POSITIONS_1953: EraPositions = {
  ethnicity: {
    turkish: { economicLean: 0.5, socialLean: 1.5 },
    kurdish: { economicLean: -0.5, socialLean: 2.0 },
    other: { economicLean: 1.0, socialLean: -1.5 },
  },
  age: {
    young: { economicLean: 0.0, socialLean: 0.5 },
    mid: { economicLean: 0.0, socialLean: 1.0 },
    mature: { economicLean: 0.5, socialLean: 1.5 },
    senior: { economicLean: 0.5, socialLean: 2.5 },
  },
  education: {
    primary_or_below: { economicLean: 0.5, socialLean: 2.5 },
    secondary: { economicLean: 0.0, socialLean: 0.5 },
    vocational: { economicLean: -0.5, socialLean: 0.0 },
    university: { economicLean: -1.5, socialLean: -3.0 },
  },
  income: {
    low: { economicLean: 0.5, socialLean: 2.0 },
    middle: { economicLean: 0.0, socialLean: 0.5 },
    high: { economicLean: 2.0, socialLean: -0.5 },
  },
  urbanization: {
    urban: { economicLean: -0.5, socialLean: -2.5 },
    suburban: { economicLean: 0.5, socialLean: 0.5 },
    rural: { economicLean: 0.5, socialLean: 3.0 },
  },
};

const POSITIONS_1979: EraPositions = {
  ethnicity: {
    turkish: { economicLean: 0.3, socialLean: 1.0 },
    kurdish: { economicLean: -1.5, socialLean: 0.5 },
    other: { economicLean: 0.0, socialLean: 0.0 },
  },
  age: {
    young: { economicLean: -1.0, socialLean: -1.0 },
    mid: { economicLean: 0.0, socialLean: 0.0 },
    mature: { economicLean: 0.5, socialLean: 1.0 },
    senior: { economicLean: 0.5, socialLean: 2.0 },
  },
  education: {
    primary_or_below: { economicLean: -0.5, socialLean: 2.0 },
    secondary: { economicLean: 0.0, socialLean: 0.5 },
    vocational: { economicLean: -0.5, socialLean: 0.0 },
    university: { economicLean: 0.5, socialLean: -2.0 },
  },
  income: {
    low: { economicLean: -2.0, socialLean: 1.0 },
    middle: { economicLean: 0.0, socialLean: 0.5 },
    high: { economicLean: 2.5, socialLean: 0.5 },
  },
  urbanization: {
    urban: { economicLean: -0.5, socialLean: -1.0 },
    suburban: { economicLean: 0.5, socialLean: 0.5 },
    rural: { economicLean: 0.5, socialLean: 2.5 },
  },
};

const ERA_POSITIONS: Partial<Record<EraId, EraPositions>> = {
  "1953": POSITIONS_1953,
  "1979": POSITIONS_1979,
  "1991": POSITIONS_1979,
  "1999": POSITIONS_1979,
  "2007": POSITIONS_1979,
  "2019": POSITIONS_1979,
  "2023": POSITIONS_1979,
};

const ERA_CENSUS: Partial<Record<EraId, Record<string, TRRegionLayer1>>> = {
  "1953": trRegionCensusData1953,
  "1979": trRegionCensusData,
  "1991": trRegionCensusData,
  "1999": trRegionCensusData,
  "2007": trRegionCensusData,
  "2019": trRegionCensusData,
  "2023": trRegionCensusData,
};

function convertCensus(
  raw: Record<string, TRRegionLayer1>
): Record<string, Record<string, Record<string, number>>> {
  return Object.fromEntries(
    Object.entries(raw).map(([regionId, layer1]) => [
      regionId,
      {
        ethnicity: layer1.ethnicity as unknown as Record<string, number>,
        age: layer1.age as unknown as Record<string, number>,
        education: layer1.education as unknown as Record<string, number>,
        income: layer1.income as unknown as Record<string, number>,
        urbanization: layer1.urbanization as unknown as Record<string, number>,
      },
    ])
  );
}

export function getTrModel(era: EraId): CountryLayer1Model {
  const census = convertCensus(ERA_CENSUS[era] ?? trRegionCensusData);
  const positions = ERA_POSITIONS[era] ?? POSITIONS_1979;
  return {
    countryId: "TR",
    categoryId: "tr_voterGroups",
    groupIds: [...TR_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: TURNOUT_RATES,
    positions,
    composition: COMPOSITION as Record<string, CountryLayer1Model["composition"][string]>,
    defaultLeans: DEFAULT_LEANS as Record<string, { economicLean: number; socialLean: number }>,
    census,
  };
}

export const trLayer1Model: CountryLayer1Model = getTrModel("1979");
export const trGroupIds = [...TR_GROUP_IDS];
