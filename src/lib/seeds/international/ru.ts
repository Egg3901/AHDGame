/**
 * USSR (SU) Layer-1 demographic model — census-consuming rebuild.
 *
 * The USSR is seeded in the 1953 and 1979 presets, but this remains a
 * single-era model: `getRuModel(era)` returns the same 1979 model for any era
 * it is asked for.
 *
 * Architecture mirrors the CN model:
 *   - dims: ["ethnicity","age","education","income","urbanization"]
 *   - census: ruRegionCensusData (1979 Soviet census, 17 regions incl. BEL/BLT)
 *   - composition: maps each Soviet archetype to census dim/key weights
 *   - region/archetype leans EMERGE from census × positions
 *
 * Axes:
 *   economicLean: -5 (command economy / state-control) to +5 (market-reform)
 *   socialLean:   -5 (cosmopolitan/liberal) to +5 (traditional/nationalist)
 *
 * 1979 anchor: a command economy at its zenith — every group sits firmly on the
 * state-control side; the intelligentsia and the grey-market high-income tier are
 * the least state-bound; Central Asia / the Caucasus are the most socially
 * traditional; the Russian core carries Soviet patriotism.
 */

import type { CountryLayer1Model, DemographicPosition } from "./types";
import { ruRegionCensusData, type SURegionLayer1 } from "@/lib/seeds/ru/ruRegionCensusData";
import { ruRegionCensusData1953 } from "@/lib/seeds/ru/ruRegionCensusData1953";
import type { EraId } from "@/lib/seeds/presetSelector";

export const SU_GROUP_IDS = [
  "party_nomenklatura",
  "industrial_worker",
  "collective_farmer",
  "urban_professional",
  "intelligentsia",
  "national_minority",
  "youth",
] as const;

type GroupId = (typeof SU_GROUP_IDS)[number];

const TURNOUT_RATES: CountryLayer1Model["turnoutRates"] = {
  ethnicity: { russian: 90, ukrainian: 88, central_asian: 85, caucasian: 84, other: 86 },
  age: { young: 80, mid: 88, mature: 90, senior: 86 },
  education: { primary_or_below: 84, secondary: 86, vocational: 87, university: 90 },
  income: { low: 84, middle: 88, high: 92 },
  urbanization: { urban: 88, suburban: 85, rural: 86 },
};

const COMPOSITION: Record<GroupId, CountryLayer1Model["composition"][string]> = {
  party_nomenklatura: {
    weights: [
      { dim: "education", key: "university", w: 0.35 },
      { dim: "income", key: "high", w: 0.3 },
      { dim: "age", key: "mature", w: 0.2 },
      { dim: "urbanization", key: "urban", w: 0.15 },
    ],
    civicMultiplier: 1.1,
  },
  industrial_worker: {
    weights: [
      { dim: "education", key: "secondary", w: 0.35 },
      { dim: "urbanization", key: "urban", w: 0.25 },
      { dim: "income", key: "middle", w: 0.25 },
      { dim: "age", key: "mature", w: 0.15 },
    ],
    civicMultiplier: 0.95,
  },
  collective_farmer: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.45 },
      { dim: "income", key: "low", w: 0.25 },
      { dim: "education", key: "primary_or_below", w: 0.2 },
      { dim: "age", key: "mature", w: 0.1 },
    ],
    civicMultiplier: 0.9,
  },
  urban_professional: {
    weights: [
      { dim: "education", key: "university", w: 0.4 },
      { dim: "urbanization", key: "urban", w: 0.25 },
      { dim: "income", key: "middle", w: 0.2 },
      { dim: "age", key: "mid", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  intelligentsia: {
    weights: [
      { dim: "education", key: "university", w: 0.5 },
      { dim: "income", key: "middle", w: 0.2 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "age", key: "mid", w: 0.1 },
    ],
    civicMultiplier: 1.0,
  },
  national_minority: {
    weights: [
      { dim: "ethnicity", key: "central_asian", w: 0.35 },
      { dim: "ethnicity", key: "caucasian", w: 0.25 },
      { dim: "ethnicity", key: "other", w: 0.2 },
      { dim: "urbanization", key: "rural", w: 0.2 },
    ],
    civicMultiplier: 0.85,
  },
  youth: {
    weights: [
      { dim: "age", key: "young", w: 0.5 },
      { dim: "education", key: "university", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.15 },
      { dim: "income", key: "middle", w: 0.1 },
    ],
    civicMultiplier: 0.9,
  },
};

const DEFAULT_LEANS: Record<GroupId, { economicLean: number; socialLean: number }> = {
  party_nomenklatura: { economicLean: -1, socialLean: 3 },
  industrial_worker: { economicLean: -2, socialLean: 1 },
  collective_farmer: { economicLean: -2, socialLean: 2 },
  urban_professional: { economicLean: 0, socialLean: 0 },
  intelligentsia: { economicLean: 0, socialLean: -1 },
  national_minority: { economicLean: -1, socialLean: 2 },
  youth: { economicLean: 0, socialLean: -1 },
};

type DimPositions = Record<string, DemographicPosition>;
type EraPositions = Record<string, DimPositions>;

// 1953 — Stalinist economy at peak rigidity; all groups deeply state-controlled.
// National minorities more suppressed; intelligentsia show no reform sympathy;
// party nomenklatura fully locked to state control (Stalin's terror in memory).
const POSITIONS_1953: EraPositions = {
  // Widened so the seventeen regions are politically distinguishable at all: the
  // previous table spanned 2.0 economically, which this derivation compresses to a
  // 0.30 spread across the whole USSR — every region identical, and the home-region
  // choice meaningless. Everything stays economically LEFT, which is correct for a
  // command economy; what changes is that regions now differ from one another.
  //
  // The census carries huge ethnic variation (Δ89-91 between regions), so ethnicity
  // does most of the work, with urbanization second (Δ46).
  ethnicity: {
    russian: { economicLean: -3.6, socialLean: 2.2 }, // Party core; most fully collectivised
    ukrainian: { economicLean: -3.2, socialLean: 1.2 }, // Holodomor memory; recent WWII losses
    central_asian: { economicLean: -0.9, socialLean: 4.2 }, // Weakest command penetration, largest grey market; deeply traditional
    caucasian: { economicLean: -1.1, socialLean: 3.6 }, // Grey-market and clan networks; Stalin was Georgian
    other: { economicLean: -2.0, socialLean: 2.0 },
  },
  age: {
    young: { economicLean: -1.4, socialLean: 0.8 }, // Komsomol generation; ideologically shaped
    mid: { economicLean: -2.0, socialLean: 1.8 }, // WWII veterans; Stalin won the war
    mature: { economicLean: -2.6, socialLean: 2.6 },
    senior: { economicLean: -3.4, socialLean: 3.6 }, // Deepest command loyalty; pre-NEP memory
  },
  education: {
    primary_or_below: { economicLean: -3.2, socialLean: 3.6 },
    secondary: { economicLean: -2.2, socialLean: 2.0 },
    vocational: { economicLean: -1.6, socialLean: 1.2 },
    university: { economicLean: -0.6, socialLean: -0.4 }, // Intelligentsia cowed but least orthodox
  },
  income: {
    low: { economicLean: -3.2, socialLean: 2.8 },
    middle: { economicLean: -2.0, socialLean: 1.8 },
    high: { economicLean: -0.6, socialLean: 1.0 }, // Nomenklatura privilege, not market reformers
  },
  urbanization: {
    urban: { economicLean: -1.0, socialLean: 0.6 }, // Industrial cities; least traditional
    suburban: { economicLean: -2.2, socialLean: 2.0 },
    rural: { economicLean: -3.8, socialLean: 4.0 }, // Collective farmers; most conservative
  },
};

const POSITIONS_1979: EraPositions = {
  ethnicity: {
    russian: { economicLean: -1.5, socialLean: 2.0 },
    ukrainian: { economicLean: -1.5, socialLean: 1.5 },
    central_asian: { economicLean: -2.0, socialLean: 3.0 },
    caucasian: { economicLean: -1.0, socialLean: 2.5 }, // grey-market traditions soften state-control
    other: { economicLean: -1.5, socialLean: 2.0 },
  },
  age: {
    young: { economicLean: -1.0, socialLean: 0.5 },
    mid: { economicLean: -1.5, socialLean: 1.5 },
    mature: { economicLean: -2.0, socialLean: 2.0 },
    senior: { economicLean: -2.5, socialLean: 2.5 },
  },
  education: {
    primary_or_below: { economicLean: -2.0, socialLean: 2.5 },
    secondary: { economicLean: -1.5, socialLean: 1.5 },
    vocational: { economicLean: -1.0, socialLean: 1.0 },
    university: { economicLean: -0.5, socialLean: 0.0 }, // reform-curious intelligentsia
  },
  income: {
    low: { economicLean: -2.0, socialLean: 2.0 },
    middle: { economicLean: -1.5, socialLean: 1.5 },
    high: { economicLean: -0.5, socialLean: 1.0 }, // nomenklatura / grey-market pragmatism
  },
  urbanization: {
    urban: { economicLean: -1.0, socialLean: 1.0 },
    suburban: { economicLean: -1.5, socialLean: 1.5 },
    rural: { economicLean: -2.0, socialLean: 2.5 },
  },
};

function convertCensus(
  raw: Record<string, SURegionLayer1>
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

const ERA_CENSUS: Partial<Record<EraId, Record<string, SURegionLayer1>>> = {
  "1953": ruRegionCensusData1953,
  "1979": ruRegionCensusData,
};

const ERA_POSITIONS: Partial<Record<EraId, EraPositions>> = {
  "1953": POSITIONS_1953,
  "1979": POSITIONS_1979,
};

export function getRuModel(era: EraId): CountryLayer1Model {
  const census = ERA_CENSUS[era] ?? ruRegionCensusData;
  const positions = ERA_POSITIONS[era] ?? POSITIONS_1979;
  return {
    countryId: "RU",
    categoryId: "su_voterGroups",
    groupIds: [...SU_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: TURNOUT_RATES,
    positions,
    composition: COMPOSITION as Record<string, CountryLayer1Model["composition"][string]>,
    defaultLeans: DEFAULT_LEANS as Record<string, { economicLean: number; socialLean: number }>,
    census: convertCensus(census),
  };
}

export const ruLayer1Model: CountryLayer1Model = getRuModel("1979");
export const suGroupIds = [...SU_GROUP_IDS];
