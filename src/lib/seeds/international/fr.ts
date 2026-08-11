/**
 * France (FR) Layer-1 demographic model — census-consuming rebuild (1979).
 * Single-era (France is 1979-preset-only here). Mirrors the CN/SU models.
 *
 * economicLean: -5 (statist/left) … +5 (market/right)
 * socialLean:   -5 (liberal/secular) … +5 (traditional/Catholic-conservative)
 *
 * 1979 anchor: a polarized Fifth-Republic electorate — a governing bourgeois
 * centre-right (RPR/UDF), a rising Socialist left, a still-strong (~20%)
 * Communist working class, and a traditional rural-Catholic right; post-'68
 * youth and graduates pull socially liberal.
 */

import type { CountryLayer1Model, DemographicPosition } from "./types";
import { frRegionCensusData, type FRRegionLayer1 } from "@/lib/seeds/fr/frRegionCensusData";
import { frRegionCensusData1953 } from "@/lib/seeds/fr/frRegionCensusData1953";
import type { EraId } from "@/lib/seeds/presetSelector";

export const FR_GROUP_IDS = [
  "bourgeois_right",
  "catholic_conservative",
  "centrist_liberal",
  "social_democrat",
  "communist_worker",
  "rural_farmer",
  "youth_student",
] as const;

type GroupId = (typeof FR_GROUP_IDS)[number];

const TURNOUT_RATES: CountryLayer1Model["turnoutRates"] = {
  ethnicity: { french: 85, european_immigrant: 70, north_african: 55, other: 65 },
  age: { young: 72, mid: 82, mature: 86, senior: 84 },
  education: { primary_or_below: 80, secondary: 82, vocational: 82, university: 88 },
  income: { low: 78, middle: 84, high: 88 },
  urbanization: { urban: 82, suburban: 84, rural: 86 },
};

const COMPOSITION: Record<GroupId, CountryLayer1Model["composition"][string]> = {
  bourgeois_right: {
    weights: [
      { dim: "income", key: "high", w: 0.4 },
      { dim: "education", key: "university", w: 0.2 },
      { dim: "urbanization", key: "suburban", w: 0.2 },
      { dim: "age", key: "mature", w: 0.2 },
    ],
    civicMultiplier: 1.05,
  },
  catholic_conservative: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.4 },
      { dim: "age", key: "senior", w: 0.3 },
      { dim: "ethnicity", key: "french", w: 0.2 },
      { dim: "education", key: "primary_or_below", w: 0.1 },
    ],
    civicMultiplier: 1.0,
  },
  centrist_liberal: {
    weights: [
      { dim: "income", key: "middle", w: 0.35 },
      { dim: "education", key: "secondary", w: 0.25 },
      { dim: "urbanization", key: "suburban", w: 0.2 },
      { dim: "age", key: "mid", w: 0.2 },
    ],
    civicMultiplier: 1.0,
  },
  social_democrat: {
    weights: [
      { dim: "education", key: "university", w: 0.35 },
      { dim: "income", key: "middle", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "age", key: "mid", w: 0.2 },
    ],
    civicMultiplier: 1.0,
  },
  communist_worker: {
    weights: [
      { dim: "income", key: "low", w: 0.4 },
      { dim: "education", key: "vocational", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "ethnicity", key: "european_immigrant", w: 0.15 },
    ],
    civicMultiplier: 0.95,
  },
  rural_farmer: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.5 },
      { dim: "age", key: "mature", w: 0.2 },
      { dim: "income", key: "low", w: 0.2 },
      { dim: "ethnicity", key: "french", w: 0.1 },
    ],
    civicMultiplier: 1.0,
  },
  youth_student: {
    weights: [
      { dim: "age", key: "young", w: 0.5 },
      { dim: "education", key: "university", w: 0.3 },
      { dim: "urbanization", key: "urban", w: 0.2 },
    ],
    civicMultiplier: 0.85,
  },
};

const DEFAULT_LEANS: Record<GroupId, { economicLean: number; socialLean: number }> = {
  bourgeois_right: { economicLean: 3, socialLean: 2 },
  catholic_conservative: { economicLean: 1, socialLean: 3 },
  centrist_liberal: { economicLean: 1, socialLean: 0 },
  social_democrat: { economicLean: -2, socialLean: -1 },
  communist_worker: { economicLean: -4, socialLean: -1 },
  rural_farmer: { economicLean: 0, socialLean: 2 },
  youth_student: { economicLean: -1, socialLean: -2 },
};

type DimPositions = Record<string, DemographicPosition>;
type EraPositions = Record<string, DimPositions>;

// 1953 — Fourth Republic; PCF at 25%+; deeper statism and Catholic traditionalism than 1979.
const POSITIONS_1953: EraPositions = {
  ethnicity: {
    french: { economicLean: -0.5, socialLean: 1.5 },
    european_immigrant: { economicLean: -1.0, socialLean: 0.5 },
    north_african: { economicLean: -2.0, socialLean: 3.5 }, // colonial subjects; largely disenfranchised
    other: { economicLean: -1.0, socialLean: 0.5 },
  },
  age: {
    young: { economicLean: -2.5, socialLean: 0.0 }, // PCF youth; student left; not yet '68-liberal
    mid: { economicLean: -0.5, socialLean: 1.0 }, // WWII generation
    mature: { economicLean: 0.0, socialLean: 1.5 },
    senior: { economicLean: 0.5, socialLean: 2.5 },
  },
  education: {
    primary_or_below: { economicLean: -1.5, socialLean: 2.0 },
    secondary: { economicLean: -0.5, socialLean: 1.0 },
    vocational: { economicLean: -0.5, socialLean: 0.5 },
    university: { economicLean: -0.5, socialLean: -1.0 }, // left-leaning universities; less liberal than 1979
  },
  income: {
    low: { economicLean: -2.5, socialLean: 1.0 },
    middle: { economicLean: -0.5, socialLean: 1.0 },
    high: { economicLean: 2.0, socialLean: 1.5 },
  },
  urbanization: {
    urban: { economicLean: -1.5, socialLean: 0.0 }, // PCF urban strongholds; Red Belt around Paris
    suburban: { economicLean: 0.0, socialLean: 1.0 },
    rural: { economicLean: 0.5, socialLean: 2.5 }, // deeply Catholic rural France
  },
};

const POSITIONS_1979: EraPositions = {
  ethnicity: {
    french: { economicLean: 0.5, socialLean: 1.0 },
    european_immigrant: { economicLean: -0.5, socialLean: 0.0 },
    north_african: { economicLean: -1.5, socialLean: 0.5 },
    other: { economicLean: -0.5, socialLean: 0.0 },
  },
  age: {
    young: { economicLean: -1.0, socialLean: -1.5 }, // post-'68
    mid: { economicLean: 0.0, socialLean: 0.0 },
    mature: { economicLean: 0.5, socialLean: 1.0 },
    senior: { economicLean: 1.0, socialLean: 2.0 },
  },
  education: {
    primary_or_below: { economicLean: -1.0, socialLean: 1.5 },
    secondary: { economicLean: 0.0, socialLean: 0.5 },
    vocational: { economicLean: 0.0, socialLean: 0.0 },
    university: { economicLean: 0.5, socialLean: -1.5 },
  },
  income: {
    low: { economicLean: -2.0, socialLean: 0.5 },
    middle: { economicLean: 0.0, socialLean: 0.5 },
    high: { economicLean: 2.5, socialLean: 1.0 },
  },
  urbanization: {
    urban: { economicLean: -0.5, socialLean: -0.5 },
    suburban: { economicLean: 0.5, socialLean: 0.5 },
    rural: { economicLean: 1.0, socialLean: 2.0 },
  },
};

function convertCensus(
  raw: Record<string, FRRegionLayer1>
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

const ERA_CENSUS: Partial<Record<EraId, Record<string, FRRegionLayer1>>> = {
  "1953": frRegionCensusData1953,
  "1979": frRegionCensusData,
};

const ERA_POSITIONS: Partial<Record<EraId, EraPositions>> = {
  "1953": POSITIONS_1953,
  "1979": POSITIONS_1979,
};

export function getFrModel(era: EraId): CountryLayer1Model {
  const census = ERA_CENSUS[era] ?? frRegionCensusData;
  const positions = ERA_POSITIONS[era] ?? POSITIONS_1979;
  return {
    countryId: "FR",
    categoryId: "fr_voterGroups",
    groupIds: [...FR_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: TURNOUT_RATES,
    positions,
    composition: COMPOSITION as Record<string, CountryLayer1Model["composition"][string]>,
    defaultLeans: DEFAULT_LEANS as Record<string, { economicLean: number; socialLean: number }>,
    census: convertCensus(census),
  };
}

export const frLayer1Model: CountryLayer1Model = getFrModel("1979");
export const frGroupIds = [...FR_GROUP_IDS];
