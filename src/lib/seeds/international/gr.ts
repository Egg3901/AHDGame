/**
 * Greece (GR) Layer-1 demographic model — census-consuming. Mirrors the TR
 * model.
 *
 * economicLean: -5 (socialist/left) … +5 (market/right)
 * socialLean:   -5 (progressive/anti-establishment) … +5 (royalist/traditional)
 *
 * 1979 anchor: the intensely politicised post-junta republic — a conservative
 * ND-voting right, a rising PASOK left riding "Allagi", a Moscow-line KKE with
 * civil-war roots, an Athens working class, a smallholder countryside, and a
 * shipping/business bourgeoisie.
 *
 * 1953 anchor: the post-civil-war kingdom — royalist right (Greek Rally) vs
 * centrist republicans vs a banned communist left voting EDA; the national
 * schism (venizelist/royalist) and the civil war are the live cleavages.
 */
import type { CountryLayer1Model, DemographicPosition } from "./types";
import { grRegionCensusData, type GRRegionLayer1 } from "@/lib/seeds/gr/grRegionCensusData";
import { grRegionCensusData1953 } from "@/lib/seeds/gr/grRegionCensusData1953";
import type { EraId } from "@/lib/seeds/presetSelector";

export const GR_GROUP_IDS = [
  "conservative_right",
  "centrist_liberal",
  "socialist_left",
  "communist_left",
  "rural_farmer",
  "urban_worker",
  "shipping_business",
] as const;

type GroupId = (typeof GR_GROUP_IDS)[number];

const TURNOUT_RATES: CountryLayer1Model["turnoutRates"] = {
  ethnicity: { greek: 81, minority: 72, other: 68 },
  age: { young: 78, mid: 82, mature: 83, senior: 78 },
  education: { primary_or_below: 78, secondary: 81, vocational: 81, university: 86 },
  income: { low: 78, middle: 81, high: 85 },
  urbanization: { urban: 82, suburban: 80, rural: 78 },
};

const COMPOSITION: Record<GroupId, CountryLayer1Model["composition"][string]> = {
  conservative_right: {
    weights: [
      { dim: "age", key: "mature", w: 0.3 },
      { dim: "urbanization", key: "rural", w: 0.25 },
      { dim: "income", key: "middle", w: 0.25 },
      { dim: "ethnicity", key: "greek", w: 0.2 },
    ],
    civicMultiplier: 1.05,
  },
  centrist_liberal: {
    weights: [
      { dim: "education", key: "secondary", w: 0.35 },
      { dim: "urbanization", key: "suburban", w: 0.25 },
      { dim: "income", key: "middle", w: 0.25 },
      { dim: "age", key: "mid", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  socialist_left: {
    weights: [
      { dim: "age", key: "young", w: 0.3 },
      { dim: "education", key: "university", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.25 },
      { dim: "income", key: "low", w: 0.2 },
    ],
    civicMultiplier: 1.1,
  },
  communist_left: {
    weights: [
      { dim: "income", key: "low", w: 0.35 },
      { dim: "urbanization", key: "urban", w: 0.3 },
      { dim: "education", key: "vocational", w: 0.2 },
      { dim: "age", key: "mature", w: 0.15 },
    ],
    civicMultiplier: 1.1,
  },
  rural_farmer: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.45 },
      { dim: "education", key: "primary_or_below", w: 0.3 },
      { dim: "income", key: "low", w: 0.25 },
    ],
    civicMultiplier: 0.95,
  },
  urban_worker: {
    weights: [
      { dim: "urbanization", key: "urban", w: 0.35 },
      { dim: "income", key: "low", w: 0.3 },
      { dim: "education", key: "vocational", w: 0.2 },
      { dim: "age", key: "mid", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  shipping_business: {
    weights: [
      { dim: "income", key: "high", w: 0.45 },
      { dim: "education", key: "university", w: 0.3 },
      { dim: "urbanization", key: "urban", w: 0.25 },
    ],
    civicMultiplier: 1.05,
  },
};

const DEFAULT_LEANS: Record<GroupId, { economicLean: number; socialLean: number }> = {
  conservative_right: { economicLean: 2, socialLean: 3 },
  centrist_liberal: { economicLean: 0, socialLean: 0 },
  socialist_left: { economicLean: -3, socialLean: -2 },
  communist_left: { economicLean: -5, socialLean: -2 },
  rural_farmer: { economicLean: 0, socialLean: 2 },
  urban_worker: { economicLean: -3, socialLean: -1 },
  shipping_business: { economicLean: 4, socialLean: 1 },
};

type DimPositions = Record<string, DemographicPosition>;
type EraPositions = Record<string, DimPositions>;

// 1953 — royalist right hegemonic after the civil war; the left is banned and
// stigmatised, voting EDA where it dares. Rural Greece leans right except the
// old venizelist and ELAS strongholds; the university produces both the state
// elite and the persecuted left intelligentsia.
const POSITIONS_1953: EraPositions = {
  ethnicity: {
    greek: { economicLean: 0.5, socialLean: 1.5 },
    minority: { economicLean: -0.5, socialLean: 1.0 },
    other: { economicLean: 0.0, socialLean: 0.0 },
  },
  age: {
    young: { economicLean: -0.5, socialLean: 0.0 },
    mid: { economicLean: 0.0, socialLean: 1.0 },
    mature: { economicLean: 0.5, socialLean: 1.5 },
    senior: { economicLean: 0.5, socialLean: 2.5 },
  },
  education: {
    primary_or_below: { economicLean: 0.5, socialLean: 2.0 },
    secondary: { economicLean: 0.0, socialLean: 0.5 },
    vocational: { economicLean: -1.0, socialLean: 0.0 },
    university: { economicLean: -0.5, socialLean: -1.0 },
  },
  income: {
    low: { economicLean: -1.0, socialLean: 1.0 },
    middle: { economicLean: 0.5, socialLean: 1.0 },
    high: { economicLean: 2.0, socialLean: 1.5 },
  },
  urbanization: {
    urban: { economicLean: -1.0, socialLean: -0.5 },
    suburban: { economicLean: 0.0, socialLean: 0.5 },
    rural: { economicLean: 0.5, socialLean: 2.0 },
  },
};

// 1979 — the post-junta realignment: PASOK harvests the young, the educated,
// and the urban wage-earner; ND holds the countryside, the old, and business;
// the KKE keeps its civil-war working-class redoubts.
const POSITIONS_1979: EraPositions = {
  ethnicity: {
    greek: { economicLean: 0.0, socialLean: 0.5 },
    minority: { economicLean: -1.0, socialLean: 0.5 },
    other: { economicLean: 0.0, socialLean: 0.0 },
  },
  age: {
    young: { economicLean: -2.0, socialLean: -1.5 },
    mid: { economicLean: -0.5, socialLean: 0.0 },
    mature: { economicLean: 0.5, socialLean: 1.0 },
    senior: { economicLean: 1.0, socialLean: 2.0 },
  },
  education: {
    primary_or_below: { economicLean: 0.0, socialLean: 1.5 },
    secondary: { economicLean: -0.5, socialLean: 0.0 },
    vocational: { economicLean: -1.0, socialLean: -0.5 },
    university: { economicLean: -1.0, socialLean: -1.5 },
  },
  income: {
    low: { economicLean: -2.0, socialLean: 0.5 },
    middle: { economicLean: 0.0, socialLean: 0.5 },
    high: { economicLean: 2.5, socialLean: 0.5 },
  },
  urbanization: {
    urban: { economicLean: -1.0, socialLean: -1.0 },
    suburban: { economicLean: -0.5, socialLean: 0.0 },
    rural: { economicLean: 0.5, socialLean: 1.5 },
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

const ERA_CENSUS: Partial<Record<EraId, Record<string, GRRegionLayer1>>> = {
  "1953": grRegionCensusData1953,
  "1979": grRegionCensusData,
  "1991": grRegionCensusData,
  "1999": grRegionCensusData,
  "2007": grRegionCensusData,
  "2019": grRegionCensusData,
  "2023": grRegionCensusData,
};

function convertCensus(
  raw: Record<string, GRRegionLayer1>
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

export function getGrModel(era: EraId): CountryLayer1Model {
  const census = convertCensus(ERA_CENSUS[era] ?? grRegionCensusData);
  const positions = ERA_POSITIONS[era] ?? POSITIONS_1979;
  return {
    countryId: "GR",
    categoryId: "gr_voterGroups",
    groupIds: [...GR_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: TURNOUT_RATES,
    positions,
    composition: COMPOSITION as Record<string, CountryLayer1Model["composition"][string]>,
    defaultLeans: DEFAULT_LEANS as Record<string, { economicLean: number; socialLean: number }>,
    census,
  };
}

export const grLayer1Model: CountryLayer1Model = getGrModel("1979");
export const grGroupIds = [...GR_GROUP_IDS];
