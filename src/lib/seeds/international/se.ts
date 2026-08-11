/**
 * Sweden (SE) Layer-1 demographic model — census-consuming (1979). Single-era.
 * Mirrors the ES/IT/FR models.
 *
 * economicLean: -5 (statist/left) … +5 (market/right)
 * socialLean:   -5 (secular/progressive) … +5 (traditional)
 *
 * 1979 anchor: the Swedish model — a vast welfare state and a unionised (LO)
 * blue-collar Social-Democratic base, a public-sector left, a business-conservative
 * bloc (Moderate), the agrarian Centre, urban Liberals, the Left Communists, and a
 * resource-economy rural North. The country skews strongly secular/progressive.
 */
import type { CountryLayer1Model, DemographicPosition } from "./types";
import { seRegionCensusData, type SERegionLayer1 } from "@/lib/seeds/se/seRegionCensusData";
import { seRegionCensusData1953 } from "@/lib/seeds/se/seRegionCensusData1953";
import type { EraId } from "@/lib/seeds/presetSelector";

export const SE_GROUP_IDS = [
  "blue_collar_sap",
  "public_sector_left",
  "business_conservative",
  "agrarian_centrist",
  "liberal_urban",
  "radical_left",
  "rural_north",
] as const;

type GroupId = (typeof SE_GROUP_IDS)[number];

const TURNOUT_RATES: CountryLayer1Model["turnoutRates"] = {
  ethnicity: { swedish: 92, immigrant: 70, other: 65 },
  age: { young: 84, mid: 92, mature: 93, senior: 90 },
  education: { primary_or_below: 88, secondary: 92, vocational: 92, university: 94 },
  income: { low: 88, middle: 92, high: 93 },
  urbanization: { urban: 91, suburban: 92, rural: 90 },
};

const COMPOSITION: Record<GroupId, CountryLayer1Model["composition"][string]> = {
  blue_collar_sap: {
    weights: [
      { dim: "income", key: "low", w: 0.35 },
      { dim: "education", key: "vocational", w: 0.3 },
      { dim: "urbanization", key: "suburban", w: 0.2 },
      { dim: "age", key: "mid", w: 0.15 },
    ],
    civicMultiplier: 1.05,
  },
  public_sector_left: {
    weights: [
      { dim: "education", key: "university", w: 0.3 },
      { dim: "income", key: "middle", w: 0.3 },
      { dim: "urbanization", key: "urban", w: 0.25 },
      { dim: "age", key: "mid", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  business_conservative: {
    weights: [
      { dim: "income", key: "high", w: 0.45 },
      { dim: "education", key: "university", w: 0.2 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "age", key: "mature", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  agrarian_centrist: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.5 },
      { dim: "ethnicity", key: "swedish", w: 0.2 },
      { dim: "income", key: "middle", w: 0.2 },
      { dim: "age", key: "mature", w: 0.1 },
    ],
    civicMultiplier: 1.0,
  },
  liberal_urban: {
    weights: [
      { dim: "education", key: "university", w: 0.35 },
      { dim: "income", key: "middle", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.25 },
      { dim: "age", key: "mid", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  radical_left: {
    weights: [
      { dim: "age", key: "young", w: 0.4 },
      { dim: "education", key: "university", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "income", key: "low", w: 0.15 },
    ],
    civicMultiplier: 0.9,
  },
  rural_north: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.4 },
      { dim: "income", key: "low", w: 0.3 },
      { dim: "ethnicity", key: "swedish", w: 0.2 },
      { dim: "age", key: "senior", w: 0.1 },
    ],
    civicMultiplier: 1.0,
  },
};

const DEFAULT_LEANS: Record<GroupId, { economicLean: number; socialLean: number }> = {
  blue_collar_sap: { economicLean: -3, socialLean: -1 },
  public_sector_left: { economicLean: -2, socialLean: -2 },
  business_conservative: { economicLean: 3, socialLean: 1 },
  agrarian_centrist: { economicLean: 0, socialLean: 0 },
  liberal_urban: { economicLean: 1, socialLean: -2 },
  radical_left: { economicLean: -4, socialLean: -2 },
  rural_north: { economicLean: -1, socialLean: 0 },
};

type DimPositions = Record<string, DemographicPosition>;
type EraPositions = Record<string, DimPositions>;

// 1953 — SAP at its peak hegemony under Erlander; class politics most binary.
// Rural North (lumberjacks/miners) is the SAP heartland alongside industrial workers.
// University = tiny Establishment elite, not yet progressive. Youth not yet radicalised
// by the 1960s. Immigration negligible — Swedish/immigrant distinction barely matters.
const POSITIONS_1953: EraPositions = {
  ethnicity: {
    swedish: { economicLean: 0.0, socialLean: 0.3 },
    immigrant: { economicLean: -0.5, socialLean: 0.0 },
    other: { economicLean: -0.5, socialLean: 0.0 },
  },
  age: {
    young: { economicLean: -0.5, socialLean: -0.5 },
    mid: { economicLean: -0.5, socialLean: 0.0 },
    mature: { economicLean: 0.2, socialLean: 0.8 },
    senior: { economicLean: 0.5, socialLean: 2.0 },
  },
  education: {
    primary_or_below: { economicLean: -1.5, socialLean: 0.5 },
    secondary: { economicLean: -0.5, socialLean: 0.0 },
    vocational: { economicLean: -1.0, socialLean: 0.0 },
    university: { economicLean: 1.5, socialLean: -0.5 },
  },
  income: {
    low: { economicLean: -3.0, socialLean: 0.0 },
    middle: { economicLean: -0.8, socialLean: 0.0 },
    high: { economicLean: 3.0, socialLean: 0.5 },
  },
  urbanization: {
    urban: { economicLean: -1.0, socialLean: -0.8 },
    suburban: { economicLean: 0.5, socialLean: 0.0 },
    rural: { economicLean: -0.5, socialLean: 1.5 },
  },
};

const POSITIONS_1979: EraPositions = {
  ethnicity: {
    swedish: { economicLean: 0.2, socialLean: 0.5 },
    immigrant: { economicLean: -1.0, socialLean: -0.5 },
    other: { economicLean: -0.5, socialLean: 0.0 },
  },
  age: {
    young: { economicLean: -1.0, socialLean: -2.0 },
    mid: { economicLean: 0.0, socialLean: -0.5 },
    mature: { economicLean: 0.3, socialLean: 0.5 },
    senior: { economicLean: 0.5, socialLean: 1.5 },
  },
  education: {
    primary_or_below: { economicLean: -1.0, socialLean: 1.0 },
    secondary: { economicLean: 0.0, socialLean: 0.0 },
    vocational: { economicLean: -0.5, socialLean: -0.5 },
    university: { economicLean: 0.5, socialLean: -1.5 },
  },
  income: {
    low: { economicLean: -2.5, socialLean: 0.0 },
    middle: { economicLean: -0.5, socialLean: 0.0 },
    high: { economicLean: 2.5, socialLean: 0.5 },
  },
  urbanization: {
    urban: { economicLean: -0.5, socialLean: -1.5 },
    suburban: { economicLean: 0.5, socialLean: 0.0 },
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

const ERA_CENSUS: Partial<Record<EraId, Record<string, SERegionLayer1>>> = {
  "1953": seRegionCensusData1953,
  "1979": seRegionCensusData,
  "1991": seRegionCensusData,
  "1999": seRegionCensusData,
  "2007": seRegionCensusData,
  "2019": seRegionCensusData,
  "2023": seRegionCensusData,
};

function convertCensus(
  raw: Record<string, SERegionLayer1>
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

export function getSeModel(era: EraId): CountryLayer1Model {
  const census = convertCensus(ERA_CENSUS[era] ?? seRegionCensusData);
  const positions = ERA_POSITIONS[era] ?? POSITIONS_1979;
  return {
    countryId: "SE",
    categoryId: "se_voterGroups",
    groupIds: [...SE_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: TURNOUT_RATES,
    positions,
    composition: COMPOSITION as Record<string, CountryLayer1Model["composition"][string]>,
    defaultLeans: DEFAULT_LEANS as Record<string, { economicLean: number; socialLean: number }>,
    census,
  };
}

export const seLayer1Model: CountryLayer1Model = getSeModel("1979");
export const seGroupIds = [...SE_GROUP_IDS];
