/**
 * Austria (AT) Layer-1 demographic model — census-consuming. Mirrors the TR/GR
 * models.
 *
 * economicLean: -5 (socialist/left) … +5 (market/right)
 * socialLean:   -5 (progressive/secular) … +5 (Catholic/traditional)
 *
 * 1979 anchor: the late-Kreisky consensus republic — the socialist Lager at
 * its absolute-majority peak, a Catholic-conservative ÖVP countryside, a small
 * national-liberal third camp, and the Sozialpartnerschaft milieus of workers,
 * farmers and business.
 *
 * 1953 anchor: the occupied Second Republic — grand-coalition Lager loyalty
 * near-total, the VdU absorbing amnestied nationals, the KPÖ propped up in the
 * Soviet zone; society Catholic, rural and reconstruction-focused.
 */
import type { CountryLayer1Model, DemographicPosition } from "./types";
import { atRegionCensusData, type ATRegionLayer1 } from "@/lib/seeds/at/atRegionCensusData";
import { atRegionCensusData1953 } from "@/lib/seeds/at/atRegionCensusData1953";
import type { EraId } from "@/lib/seeds/presetSelector";

export const AT_GROUP_IDS = [
  "socialist_lager",
  "catholic_conservative",
  "national_liberal",
  "rural_farmer",
  "urban_worker",
  "business_professional",
  "communist_left",
] as const;

type GroupId = (typeof AT_GROUP_IDS)[number];

const TURNOUT_RATES: CountryLayer1Model["turnoutRates"] = {
  ethnicity: { austrian: 92, minority: 86, other: 74 },
  age: { young: 88, mid: 93, mature: 94, senior: 90 },
  education: { primary_or_below: 90, secondary: 92, vocational: 92, university: 94 },
  income: { low: 89, middle: 92, high: 94 },
  urbanization: { urban: 92, suburban: 92, rural: 91 },
};

const COMPOSITION: Record<GroupId, CountryLayer1Model["composition"][string]> = {
  socialist_lager: {
    weights: [
      { dim: "urbanization", key: "urban", w: 0.35 },
      { dim: "income", key: "low", w: 0.25 },
      { dim: "education", key: "vocational", w: 0.2 },
      { dim: "age", key: "mature", w: 0.2 },
    ],
    civicMultiplier: 1.1,
  },
  catholic_conservative: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.3 },
      { dim: "age", key: "mature", w: 0.25 },
      { dim: "income", key: "middle", w: 0.25 },
      { dim: "ethnicity", key: "austrian", w: 0.2 },
    ],
    civicMultiplier: 1.1,
  },
  national_liberal: {
    weights: [
      { dim: "education", key: "secondary", w: 0.3 },
      { dim: "income", key: "middle", w: 0.3 },
      { dim: "urbanization", key: "suburban", w: 0.25 },
      { dim: "age", key: "mid", w: 0.15 },
    ],
    civicMultiplier: 0.95,
  },
  rural_farmer: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.45 },
      { dim: "education", key: "primary_or_below", w: 0.3 },
      { dim: "income", key: "low", w: 0.25 },
    ],
    civicMultiplier: 1.0,
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
  business_professional: {
    weights: [
      { dim: "income", key: "high", w: 0.45 },
      { dim: "education", key: "university", w: 0.3 },
      { dim: "urbanization", key: "urban", w: 0.25 },
    ],
    civicMultiplier: 1.05,
  },
  communist_left: {
    weights: [
      { dim: "income", key: "low", w: 0.4 },
      { dim: "urbanization", key: "urban", w: 0.3 },
      { dim: "education", key: "vocational", w: 0.2 },
      { dim: "age", key: "senior", w: 0.1 },
    ],
    civicMultiplier: 1.05,
  },
};

const DEFAULT_LEANS: Record<GroupId, { economicLean: number; socialLean: number }> = {
  socialist_lager: { economicLean: -3, socialLean: -1 },
  catholic_conservative: { economicLean: 2, socialLean: 3 },
  national_liberal: { economicLean: 2, socialLean: 2 },
  rural_farmer: { economicLean: 1, socialLean: 3 },
  urban_worker: { economicLean: -3, socialLean: 0 },
  business_professional: { economicLean: 4, socialLean: 1 },
  communist_left: { economicLean: -5, socialLean: -2 },
};

type DimPositions = Record<string, DemographicPosition>;
type EraPositions = Record<string, DimPositions>;

// 1953 — the two great Lager split the occupied republic almost evenly; the
// countryside is Catholic and ÖVP, Red Vienna holds for the SPÖ, and the
// university still leans to the national camp rather than the left.
const POSITIONS_1953: EraPositions = {
  ethnicity: {
    austrian: { economicLean: 0.0, socialLean: 1.0 },
    minority: { economicLean: -0.5, socialLean: 0.5 },
    other: { economicLean: 0.0, socialLean: 0.0 },
  },
  age: {
    young: { economicLean: -0.5, socialLean: 0.0 },
    mid: { economicLean: 0.0, socialLean: 0.5 },
    mature: { economicLean: 0.0, socialLean: 1.0 },
    senior: { economicLean: 0.5, socialLean: 2.0 },
  },
  education: {
    primary_or_below: { economicLean: 0.0, socialLean: 1.5 },
    secondary: { economicLean: 0.5, socialLean: 0.5 },
    vocational: { economicLean: -1.5, socialLean: 0.0 },
    university: { economicLean: 1.0, socialLean: 0.5 },
  },
  income: {
    low: { economicLean: -1.5, socialLean: 0.5 },
    middle: { economicLean: 0.5, socialLean: 1.0 },
    high: { economicLean: 2.0, socialLean: 1.0 },
  },
  urbanization: {
    urban: { economicLean: -1.5, socialLean: -1.0 },
    suburban: { economicLean: 0.0, socialLean: 0.5 },
    rural: { economicLean: 1.0, socialLean: 2.5 },
  },
};

// 1979 — Kreisky's SPÖ reaches beyond the working class into the new white-
// collar suburbs; the ÖVP holds the Catholic countryside; the FPÖ third camp
// is small and provincial.
const POSITIONS_1979: EraPositions = {
  ethnicity: {
    austrian: { economicLean: 0.0, socialLean: 0.5 },
    minority: { economicLean: -1.0, socialLean: 0.5 },
    other: { economicLean: 0.0, socialLean: 0.0 },
  },
  age: {
    young: { economicLean: -1.5, socialLean: -1.5 },
    mid: { economicLean: -0.5, socialLean: 0.0 },
    mature: { economicLean: 0.0, socialLean: 1.0 },
    senior: { economicLean: 0.5, socialLean: 2.0 },
  },
  education: {
    primary_or_below: { economicLean: 0.0, socialLean: 1.5 },
    secondary: { economicLean: -0.5, socialLean: 0.0 },
    vocational: { economicLean: -1.5, socialLean: 0.0 },
    university: { economicLean: -0.5, socialLean: -1.5 },
  },
  income: {
    low: { economicLean: -2.0, socialLean: 0.5 },
    middle: { economicLean: -0.5, socialLean: 0.5 },
    high: { economicLean: 2.5, socialLean: 0.5 },
  },
  urbanization: {
    urban: { economicLean: -1.5, socialLean: -1.0 },
    suburban: { economicLean: -0.5, socialLean: 0.0 },
    rural: { economicLean: 1.0, socialLean: 2.0 },
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

const ERA_CENSUS: Partial<Record<EraId, Record<string, ATRegionLayer1>>> = {
  "1953": atRegionCensusData1953,
  "1979": atRegionCensusData,
  "1991": atRegionCensusData,
  "1999": atRegionCensusData,
  "2007": atRegionCensusData,
  "2019": atRegionCensusData,
  "2023": atRegionCensusData,
};

function convertCensus(
  raw: Record<string, ATRegionLayer1>
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

export function getAtModel(era: EraId): CountryLayer1Model {
  const census = convertCensus(ERA_CENSUS[era] ?? atRegionCensusData);
  const positions = ERA_POSITIONS[era] ?? POSITIONS_1979;
  return {
    countryId: "AT",
    categoryId: "at_voterGroups",
    groupIds: [...AT_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: TURNOUT_RATES,
    positions,
    composition: COMPOSITION as Record<string, CountryLayer1Model["composition"][string]>,
    defaultLeans: DEFAULT_LEANS as Record<string, { economicLean: number; socialLean: number }>,
    census,
  };
}

export const atLayer1Model: CountryLayer1Model = getAtModel("1979");
export const atGroupIds = [...AT_GROUP_IDS];
