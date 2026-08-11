/**
 * Spain (ES) Layer-1 demographic model — census-consuming (1979). Single-era.
 * Mirrors the IT/FR models.
 *
 * economicLean: -5 (statist/left) … +5 (market/right)
 * socialLean:   -5 (secular/progressive) … +5 (traditional/Catholic-Francoist)
 *
 * 1979 anchor: the Transition — a young democracy four years after Franco. A
 * Catholic conservative right (AP, Franco-era voters), a centrist UCD bloc, a
 * rising Socialist (PSOE) and Communist (PCE) working class, peripheral
 * nationalisms (Catalonia, the Basque Country), and a highly progressive
 * post-Franco youth.
 */
import type { CountryLayer1Model, DemographicPosition } from "./types";
import { esRegionCensusData, type ESRegionLayer1 } from "@/lib/seeds/es/esRegionCensusData";
import { esRegionCensusData1953 } from "@/lib/seeds/es/esRegionCensusData1953";
import type { EraId } from "@/lib/seeds/presetSelector";

export const ES_GROUP_IDS = [
  "conservative_catholic",
  "centrist",
  "socialist_worker",
  "communist_worker",
  "regional_nationalist",
  "urban_professional",
  "youth_democratic",
] as const;

type GroupId = (typeof ES_GROUP_IDS)[number];

const TURNOUT_RATES: CountryLayer1Model["turnoutRates"] = {
  ethnicity: { spanish: 70, regional: 72, other: 55 },
  age: { young: 62, mid: 72, mature: 74, senior: 70 },
  education: { primary_or_below: 66, secondary: 72, vocational: 72, university: 78 },
  income: { low: 66, middle: 72, high: 74 },
  urbanization: { urban: 72, suburban: 70, rural: 68 },
};

const COMPOSITION: Record<GroupId, CountryLayer1Model["composition"][string]> = {
  conservative_catholic: {
    weights: [
      { dim: "age", key: "senior", w: 0.3 },
      { dim: "urbanization", key: "rural", w: 0.3 },
      { dim: "education", key: "primary_or_below", w: 0.2 },
      { dim: "ethnicity", key: "spanish", w: 0.2 },
    ],
    civicMultiplier: 1.0,
  },
  centrist: {
    weights: [
      { dim: "income", key: "middle", w: 0.35 },
      { dim: "education", key: "secondary", w: 0.25 },
      { dim: "age", key: "mature", w: 0.2 },
      { dim: "urbanization", key: "suburban", w: 0.2 },
    ],
    civicMultiplier: 1.0,
  },
  socialist_worker: {
    weights: [
      { dim: "income", key: "low", w: 0.35 },
      { dim: "education", key: "vocational", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.25 },
      { dim: "age", key: "mid", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  communist_worker: {
    weights: [
      { dim: "income", key: "low", w: 0.4 },
      { dim: "urbanization", key: "urban", w: 0.3 },
      { dim: "education", key: "vocational", w: 0.2 },
      { dim: "age", key: "mid", w: 0.1 },
    ],
    civicMultiplier: 0.95,
  },
  regional_nationalist: {
    weights: [
      { dim: "ethnicity", key: "regional", w: 0.6 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "income", key: "middle", w: 0.2 },
    ],
    civicMultiplier: 1.05,
  },
  urban_professional: {
    weights: [
      { dim: "education", key: "university", w: 0.4 },
      { dim: "income", key: "high", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "age", key: "mid", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  youth_democratic: {
    weights: [
      { dim: "age", key: "young", w: 0.55 },
      { dim: "education", key: "university", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.2 },
    ],
    civicMultiplier: 0.85,
  },
};

const DEFAULT_LEANS: Record<GroupId, { economicLean: number; socialLean: number }> = {
  conservative_catholic: { economicLean: 2, socialLean: 3 },
  centrist: { economicLean: 1, socialLean: 1 },
  socialist_worker: { economicLean: -2, socialLean: -2 },
  communist_worker: { economicLean: -4, socialLean: -2 },
  regional_nationalist: { economicLean: 0, socialLean: -1 },
  urban_professional: { economicLean: 1, socialLean: -1 },
  youth_democratic: { economicLean: -2, socialLean: -3 },
};

type DimPositions = Record<string, DemographicPosition>;
type EraPositions = Record<string, DimPositions>;

// 1953 — Francoist Spain: corporatist autarky, ultra-Catholic, deeply authoritarian.
// Game models Spain as a functional state even under Franco for playability.
// Very high socialLean across the board; economic lean moderately statist (autarky regime).
// Regional minorities deeply suppressed but their underlying lean is nationalist/opposition.
const POSITIONS_1953: EraPositions = {
  ethnicity: {
    spanish: { economicLean: -1.0, socialLean: 3.5 }, // Nationalist Spain; autarky + Catholic social values
    regional: { economicLean: -0.5, socialLean: -1.0 }, // Basques/Catalans: suppressed; opposition-leaning
    other: { economicLean: -0.5, socialLean: 1.0 },
  },
  age: {
    young: { economicLean: -0.5, socialLean: 2.0 }, // Indoctrinated by Falangist/Church education; some reformers
    mid: { economicLean: -1.0, socialLean: 2.5 }, // Civil War era; polarized; many Franco-loyalists
    mature: { economicLean: -1.0, socialLean: 3.0 },
    senior: { economicLean: -0.5, socialLean: 4.0 }, // deeply traditional; Church authority strongest
  },
  education: {
    primary_or_below: { economicLean: -1.0, socialLean: 3.5 }, // vast agrarian population; Church-educated
    secondary: { economicLean: -0.5, socialLean: 2.5 },
    vocational: { economicLean: -1.0, socialLean: 2.0 },
    university: { economicLean: 0.5, socialLean: 1.0 }, // small secular elite; some technocrats
  },
  income: {
    low: { economicLean: -1.5, socialLean: 2.0 }, // agricultural workers; poor; traditional
    middle: { economicLean: -0.5, socialLean: 2.5 },
    high: { economicLean: 0.5, socialLean: 3.0 }, // Francoist elite; landed class; Church ties
  },
  urbanization: {
    urban: { economicLean: -1.0, socialLean: 2.0 }, // workers + Falangist bureaucracy; mixed
    suburban: { economicLean: -0.5, socialLean: 2.5 },
    rural: { economicLean: -1.0, socialLean: 4.0 }, // most conservative; cacique rural power structures
  },
};

const POSITIONS_1979: EraPositions = {
  ethnicity: {
    spanish: { economicLean: 0.3, socialLean: 1.0 },
    regional: { economicLean: -0.3, socialLean: -0.5 },
    other: { economicLean: 0.0, socialLean: 0.0 },
  },
  age: {
    young: { economicLean: -1.5, socialLean: -2.5 },
    mid: { economicLean: 0.0, socialLean: 0.0 },
    mature: { economicLean: 0.5, socialLean: 1.5 },
    senior: { economicLean: 0.5, socialLean: 3.0 },
  },
  education: {
    primary_or_below: { economicLean: -0.5, socialLean: 2.0 },
    secondary: { economicLean: 0.0, socialLean: 0.5 },
    vocational: { economicLean: -0.5, socialLean: 0.0 },
    university: { economicLean: 0.5, socialLean: -1.5 },
  },
  income: {
    low: { economicLean: -2.5, socialLean: 1.0 },
    middle: { economicLean: 0.0, socialLean: 0.5 },
    high: { economicLean: 2.5, socialLean: 1.5 },
  },
  urbanization: {
    urban: { economicLean: -1.0, socialLean: -1.0 },
    suburban: { economicLean: 0.5, socialLean: 0.5 },
    rural: { economicLean: 0.0, socialLean: 2.5 },
  },
};

function convertCensus(
  raw: Record<string, ESRegionLayer1>
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

const ERA_CENSUS: Partial<Record<EraId, Record<string, ESRegionLayer1>>> = {
  "1953": esRegionCensusData1953,
  "1979": esRegionCensusData,
};

const ERA_POSITIONS: Partial<Record<EraId, EraPositions>> = {
  "1953": POSITIONS_1953,
  "1979": POSITIONS_1979,
};

export function getEsModel(era: EraId): CountryLayer1Model {
  const census = ERA_CENSUS[era] ?? esRegionCensusData;
  const positions = ERA_POSITIONS[era] ?? POSITIONS_1979;
  return {
    countryId: "ES",
    categoryId: "es_voterGroups",
    groupIds: [...ES_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: TURNOUT_RATES,
    positions,
    composition: COMPOSITION as Record<string, CountryLayer1Model["composition"][string]>,
    defaultLeans: DEFAULT_LEANS as Record<string, { economicLean: number; socialLean: number }>,
    census: convertCensus(census),
  };
}

export const esLayer1Model: CountryLayer1Model = getEsModel("1979");
export const esGroupIds = [...ES_GROUP_IDS];
