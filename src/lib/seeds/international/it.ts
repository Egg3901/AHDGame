/**
 * Italy (IT) Layer-1 demographic model — census-consuming (1979). Single-era.
 * Mirrors the FR/CN models.
 *
 * economicLean: -5 (statist/left) … +5 (market/right)
 * socialLean:   -5 (secular/liberal) … +5 (traditional/Catholic)
 *
 * 1979 anchor: the historic-compromise First Republic — a Catholic DC base
 * (rural + clientelist South), a vast PCI working class (industrial North + the
 * "red belt" Center), the PSI, a northern industrial bourgeoisie, and radicalised
 * post-'68 youth.
 */
import type { CountryLayer1Model, DemographicPosition } from "./types";
import { itRegionCensusData, type ITRegionLayer1 } from "@/lib/seeds/it/itRegionCensusData";
import { itRegionCensusData1953 } from "@/lib/seeds/it/itRegionCensusData1953";
import type { EraId } from "@/lib/seeds/presetSelector";

export const IT_GROUP_IDS = [
  "catholic_dc",
  "industrial_north",
  "communist_worker",
  "socialist",
  "southern_client",
  "secular_liberal",
  "youth_radical",
] as const;

type GroupId = (typeof IT_GROUP_IDS)[number];

const TURNOUT_RATES: CountryLayer1Model["turnoutRates"] = {
  ethnicity: { italian: 90, immigrant: 60, other: 70 },
  age: { young: 80, mid: 90, mature: 92, senior: 88 },
  education: { primary_or_below: 86, secondary: 90, vocational: 90, university: 92 },
  income: { low: 86, middle: 90, high: 90 },
  urbanization: { urban: 90, suburban: 90, rural: 88 },
};

const COMPOSITION: Record<GroupId, CountryLayer1Model["composition"][string]> = {
  catholic_dc: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.3 },
      { dim: "education", key: "primary_or_below", w: 0.25 },
      { dim: "age", key: "mature", w: 0.25 },
      { dim: "ethnicity", key: "italian", w: 0.2 },
    ],
    civicMultiplier: 1.05,
  },
  industrial_north: {
    weights: [
      { dim: "income", key: "high", w: 0.4 },
      { dim: "education", key: "university", w: 0.2 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "age", key: "mature", w: 0.2 },
    ],
    civicMultiplier: 1.0,
  },
  communist_worker: {
    weights: [
      { dim: "income", key: "low", w: 0.4 },
      { dim: "education", key: "vocational", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "age", key: "mid", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  socialist: {
    weights: [
      { dim: "income", key: "middle", w: 0.35 },
      { dim: "education", key: "secondary", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "age", key: "mid", w: 0.2 },
    ],
    civicMultiplier: 0.95,
  },
  southern_client: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.35 },
      { dim: "income", key: "low", w: 0.35 },
      { dim: "ethnicity", key: "italian", w: 0.15 },
      { dim: "age", key: "senior", w: 0.15 },
    ],
    civicMultiplier: 0.95,
  },
  secular_liberal: {
    weights: [
      { dim: "education", key: "university", w: 0.4 },
      { dim: "income", key: "high", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "age", key: "mid", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  youth_radical: {
    weights: [
      { dim: "age", key: "young", w: 0.55 },
      { dim: "education", key: "university", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.2 },
    ],
    civicMultiplier: 0.85,
  },
};

const DEFAULT_LEANS: Record<GroupId, { economicLean: number; socialLean: number }> = {
  catholic_dc: { economicLean: 1, socialLean: 3 },
  industrial_north: { economicLean: 3, socialLean: 1 },
  communist_worker: { economicLean: -4, socialLean: -1 },
  socialist: { economicLean: -2, socialLean: -1 },
  southern_client: { economicLean: -1, socialLean: 2 },
  secular_liberal: { economicLean: 1, socialLean: -1 },
  youth_radical: { economicLean: -2, socialLean: -3 },
};

type DimPositions = Record<string, DemographicPosition>;
type EraPositions = Record<string, DimPositions>;

// 1953 — DC at 48.5%; PCI+PSI at 35%; economic miracle not yet begun; deeply Catholic society.
const POSITIONS_1953: EraPositions = {
  ethnicity: {
    italian: { economicLean: -0.5, socialLean: 2.0 }, // more statist (IRI, ENI); more Catholic
    immigrant: { economicLean: -0.5, socialLean: 0.5 },
    other: { economicLean: -0.5, socialLean: 0.5 },
  },
  age: {
    young: { economicLean: -2.5, socialLean: -0.5 }, // PCI youth; not yet '68 liberal
    mid: { economicLean: -0.5, socialLean: 1.0 }, // WWII generation; DC/PCI split
    mature: { economicLean: 0.5, socialLean: 2.0 },
    senior: { economicLean: 0.5, socialLean: 3.0 }, // deeply traditional
  },
  education: {
    primary_or_below: { economicLean: -1.0, socialLean: 2.5 }, // agrarian south; very Catholic
    secondary: { economicLean: 0.0, socialLean: 1.0 },
    vocational: { economicLean: -0.5, socialLean: 0.5 },
    university: { economicLean: -0.5, socialLean: -1.0 }, // left-leaning universities; some secular
  },
  income: {
    low: { economicLean: -2.5, socialLean: 1.0 },
    middle: { economicLean: 0.0, socialLean: 1.5 },
    high: { economicLean: 2.5, socialLean: 2.0 },
  },
  urbanization: {
    urban: { economicLean: -1.5, socialLean: 0.0 }, // PCI/PSI industrial north and red belt center
    suburban: { economicLean: 0.5, socialLean: 1.5 },
    rural: { economicLean: -0.5, socialLean: 3.0 }, // Catholic agrarian south; DC clientelism
  },
};

const POSITIONS_1979: EraPositions = {
  ethnicity: {
    italian: { economicLean: 0.5, socialLean: 1.5 },
    immigrant: { economicLean: -0.5, socialLean: 0.0 },
    other: { economicLean: 0.0, socialLean: 0.5 },
  },
  age: {
    young: { economicLean: -1.5, socialLean: -2.0 },
    mid: { economicLean: 0.0, socialLean: 0.0 },
    mature: { economicLean: 0.5, socialLean: 1.5 },
    senior: { economicLean: 0.5, socialLean: 2.5 },
  },
  education: {
    primary_or_below: { economicLean: -0.5, socialLean: 2.0 },
    secondary: { economicLean: 0.0, socialLean: 0.5 },
    vocational: { economicLean: 0.0, socialLean: 0.0 },
    university: { economicLean: 0.5, socialLean: -1.5 },
  },
  income: {
    low: { economicLean: -2.5, socialLean: 0.5 },
    middle: { economicLean: 0.0, socialLean: 1.0 },
    high: { economicLean: 2.5, socialLean: 1.5 },
  },
  urbanization: {
    urban: { economicLean: -1.0, socialLean: -0.5 },
    suburban: { economicLean: 0.5, socialLean: 1.0 },
    rural: { economicLean: 0.0, socialLean: 2.5 },
  },
};

function convertCensus(
  raw: Record<string, ITRegionLayer1>
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

const ERA_CENSUS: Partial<Record<EraId, Record<string, ITRegionLayer1>>> = {
  "1953": itRegionCensusData1953,
  "1979": itRegionCensusData,
};

const ERA_POSITIONS: Partial<Record<EraId, EraPositions>> = {
  "1953": POSITIONS_1953,
  "1979": POSITIONS_1979,
};

export function getItModel(era: EraId): CountryLayer1Model {
  const census = ERA_CENSUS[era] ?? itRegionCensusData;
  const positions = ERA_POSITIONS[era] ?? POSITIONS_1979;
  return {
    countryId: "IT",
    categoryId: "it_voterGroups",
    groupIds: [...IT_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: TURNOUT_RATES,
    positions,
    composition: COMPOSITION as Record<string, CountryLayer1Model["composition"][string]>,
    defaultLeans: DEFAULT_LEANS as Record<string, { economicLean: number; socialLean: number }>,
    census: convertCensus(census),
  };
}

export const itLayer1Model: CountryLayer1Model = getItModel("1979");
export const itGroupIds = [...IT_GROUP_IDS];
