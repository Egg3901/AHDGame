/**
 * Finland (FI) Layer-1 demographic model — census-consuming. Mirrors the
 * TR/GR/AT models.
 *
 * economicLean: -5 (socialist/left) … +5 (market/right)
 * socialLean:   -5 (progressive/secular) … +5 (agrarian/traditional)
 *
 * 1979 anchor: the late-Kekkonen multiparty field — a big SDP anchored in the
 * lähiö suburbs and industrial towns, the Centre holding the emptying
 * countryside, a rising urban Kokoomus kept from office by the eastern
 * relationship, and SKDL redoubts in the mill towns, the smallholder east and
 * Lapland.
 *
 * 1953 anchor: the postwar republic — an agrarian-dominated countryside
 * (Maalaisliitto), a divided working class split between SDP and SKDL, the
 * Swedish-speaking coasts liberal, and the resettled Karelian east radicalised
 * in both agrarian and communist directions.
 */
import type { CountryLayer1Model, DemographicPosition } from "./types";
import { fiRegionCensusData, type FIRegionLayer1 } from "@/lib/seeds/fi/fiRegionCensusData";
import { fiRegionCensusData1953 } from "@/lib/seeds/fi/fiRegionCensusData1953";
import type { EraId } from "@/lib/seeds/presetSelector";

export const FI_GROUP_IDS = [
  "social_democrat",
  "agrarian_centre",
  "conservative_right",
  "communist_left",
  "swedish_liberal",
  "urban_worker",
  "rural_smallholder",
] as const;

type GroupId = (typeof FI_GROUP_IDS)[number];

const TURNOUT_RATES: CountryLayer1Model["turnoutRates"] = {
  ethnicity: { finnish: 82, minority: 84, other: 70 },
  age: { young: 76, mid: 83, mature: 85, senior: 80 },
  education: { primary_or_below: 78, secondary: 82, vocational: 82, university: 88 },
  income: { low: 77, middle: 83, high: 87 },
  urbanization: { urban: 82, suburban: 82, rural: 81 },
};

const COMPOSITION: Record<GroupId, CountryLayer1Model["composition"][string]> = {
  social_democrat: {
    weights: [
      { dim: "urbanization", key: "suburban", w: 0.3 },
      { dim: "education", key: "vocational", w: 0.25 },
      { dim: "income", key: "middle", w: 0.25 },
      { dim: "age", key: "mid", w: 0.2 },
    ],
    civicMultiplier: 1.05,
  },
  agrarian_centre: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.4 },
      { dim: "education", key: "primary_or_below", w: 0.25 },
      { dim: "income", key: "middle", w: 0.2 },
      { dim: "age", key: "mature", w: 0.15 },
    ],
    civicMultiplier: 1.05,
  },
  conservative_right: {
    weights: [
      { dim: "income", key: "high", w: 0.35 },
      { dim: "education", key: "university", w: 0.3 },
      { dim: "urbanization", key: "urban", w: 0.35 },
    ],
    civicMultiplier: 1.05,
  },
  communist_left: {
    weights: [
      { dim: "income", key: "low", w: 0.35 },
      { dim: "education", key: "vocational", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "age", key: "mature", w: 0.2 },
    ],
    civicMultiplier: 1.05,
  },
  swedish_liberal: {
    weights: [
      { dim: "ethnicity", key: "minority", w: 0.7 },
      { dim: "income", key: "middle", w: 0.3 },
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
  rural_smallholder: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.45 },
      { dim: "income", key: "low", w: 0.3 },
      { dim: "education", key: "primary_or_below", w: 0.25 },
    ],
    civicMultiplier: 0.95,
  },
};

const DEFAULT_LEANS: Record<GroupId, { economicLean: number; socialLean: number }> = {
  social_democrat: { economicLean: -2, socialLean: -1 },
  agrarian_centre: { economicLean: 0, socialLean: 3 },
  conservative_right: { economicLean: 3, socialLean: 2 },
  communist_left: { economicLean: -4, socialLean: -1 },
  swedish_liberal: { economicLean: 1, socialLean: 0 },
  urban_worker: { economicLean: -3, socialLean: -1 },
  rural_smallholder: { economicLean: 0, socialLean: 3 },
};

type DimPositions = Record<string, DemographicPosition>;
type EraPositions = Record<string, DimPositions>;

// 1953 — the agrarian republic: a countryside split between Maalaisliitto
// tradition and SKDL cold-farm radicalism, a divided urban working class, and
// a small educated elite spanning liberal and conservative camps.
const POSITIONS_1953: EraPositions = {
  ethnicity: {
    finnish: { economicLean: -0.5, socialLean: 1.0 },
    minority: { economicLean: 0.5, socialLean: 0.5 },
    other: { economicLean: 0.0, socialLean: 0.0 },
  },
  age: {
    young: { economicLean: -1.0, socialLean: 0.0 },
    mid: { economicLean: -0.5, socialLean: 0.5 },
    mature: { economicLean: 0.0, socialLean: 1.0 },
    senior: { economicLean: 0.0, socialLean: 2.0 },
  },
  education: {
    primary_or_below: { economicLean: -0.5, socialLean: 1.5 },
    secondary: { economicLean: 0.5, socialLean: 0.5 },
    vocational: { economicLean: -1.5, socialLean: 0.0 },
    university: { economicLean: 1.0, socialLean: 0.5 },
  },
  income: {
    low: { economicLean: -1.5, socialLean: 0.5 },
    middle: { economicLean: 0.0, socialLean: 1.0 },
    high: { economicLean: 2.0, socialLean: 1.0 },
  },
  urbanization: {
    urban: { economicLean: -1.5, socialLean: -1.0 },
    suburban: { economicLean: -0.5, socialLean: 0.0 },
    rural: { economicLean: -0.5, socialLean: 2.0 },
  },
};

// 1979 — the settled Kekkonen order: SDP suburbs, a Centre countryside losing
// people to the towns, Kokoomus gaining the educated urban middle class, SKDL
// strong among older industrial workers and the north-east periphery.
const POSITIONS_1979: EraPositions = {
  ethnicity: {
    finnish: { economicLean: 0.0, socialLean: 0.5 },
    minority: { economicLean: 0.5, socialLean: 0.0 },
    other: { economicLean: 0.0, socialLean: 0.0 },
  },
  age: {
    young: { economicLean: -1.0, socialLean: -1.5 },
    mid: { economicLean: -0.5, socialLean: 0.0 },
    mature: { economicLean: 0.0, socialLean: 1.0 },
    senior: { economicLean: 0.0, socialLean: 2.0 },
  },
  education: {
    primary_or_below: { economicLean: -0.5, socialLean: 1.5 },
    secondary: { economicLean: 0.0, socialLean: 0.0 },
    vocational: { economicLean: -1.5, socialLean: 0.0 },
    university: { economicLean: 0.5, socialLean: -1.0 },
  },
  income: {
    low: { economicLean: -2.0, socialLean: 0.5 },
    middle: { economicLean: 0.0, socialLean: 0.0 },
    high: { economicLean: 2.5, socialLean: 0.5 },
  },
  urbanization: {
    urban: { economicLean: -0.5, socialLean: -1.0 },
    suburban: { economicLean: -1.0, socialLean: -0.5 },
    rural: { economicLean: 0.0, socialLean: 2.0 },
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

const ERA_CENSUS: Partial<Record<EraId, Record<string, FIRegionLayer1>>> = {
  "1953": fiRegionCensusData1953,
  "1979": fiRegionCensusData,
  "1991": fiRegionCensusData,
  "1999": fiRegionCensusData,
  "2007": fiRegionCensusData,
  "2019": fiRegionCensusData,
  "2023": fiRegionCensusData,
};

function convertCensus(
  raw: Record<string, FIRegionLayer1>
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

export function getFiModel(era: EraId): CountryLayer1Model {
  const census = convertCensus(ERA_CENSUS[era] ?? fiRegionCensusData);
  const positions = ERA_POSITIONS[era] ?? POSITIONS_1979;
  return {
    countryId: "FI",
    categoryId: "fi_voterGroups",
    groupIds: [...FI_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: TURNOUT_RATES,
    positions,
    composition: COMPOSITION as Record<string, CountryLayer1Model["composition"][string]>,
    defaultLeans: DEFAULT_LEANS as Record<string, { economicLean: number; socialLean: number }>,
    census,
  };
}

export const fiLayer1Model: CountryLayer1Model = getFiModel("1979");
export const fiGroupIds = [...FI_GROUP_IDS];
