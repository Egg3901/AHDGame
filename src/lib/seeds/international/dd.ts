/**
 * East Germany (DD) Layer-1 demographic model — census-consuming, era-aware
 * (1953 + 1979). Mirrors the SU command-economy model.
 *
 * economicLean: -5 (planned/socialist) … +5 (market/reform)
 * socialLean:   -5 (secular/liberal) … +5 (traditional)
 *
 * 1979 anchor: a consolidated SED state — a loyal nomenklatura, a large industrial
 * working class and collective farmers anchored to the plan, a reform-curious
 * technical intelligentsia, a residual Christian milieu, and an FDJ-organised
 * youth. The electorate leans heavily statist; reform pressure sits with the
 * intelligentsia and the young.
 */
import type { CountryLayer1Model, DemographicPosition } from "./types";
import { ddRegionCensusData, type DDRegionLayer1 } from "@/lib/seeds/dd/ddRegionCensusData";
import { ddRegionCensusData1953 } from "@/lib/seeds/dd/ddRegionCensusData1953";
import type { EraId } from "@/lib/seeds/presetSelector";

export const DD_GROUP_IDS = [
  "party_nomenklatura",
  "industrial_worker",
  "collective_farmer",
  "intelligentsia",
  "christian_milieu",
  "youth",
] as const;

type GroupId = (typeof DD_GROUP_IDS)[number];

const TURNOUT_RATES: CountryLayer1Model["turnoutRates"] = {
  ethnicity: { german: 95, other: 80 },
  age: { young: 90, mid: 95, mature: 96, senior: 94 },
  education: { primary_or_below: 94, secondary: 95, vocational: 95, university: 96 },
  income: { low: 94, middle: 95, high: 96 },
  urbanization: { urban: 95, suburban: 95, rural: 94 },
};

const COMPOSITION: Record<GroupId, CountryLayer1Model["composition"][string]> = {
  party_nomenklatura: {
    weights: [
      { dim: "income", key: "high", w: 0.4 },
      { dim: "education", key: "university", w: 0.3 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "age", key: "mature", w: 0.1 },
    ],
    civicMultiplier: 1.1,
  },
  industrial_worker: {
    weights: [
      { dim: "income", key: "low", w: 0.35 },
      { dim: "education", key: "vocational", w: 0.35 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "age", key: "mid", w: 0.1 },
    ],
    civicMultiplier: 1.0,
  },
  collective_farmer: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.5 },
      { dim: "income", key: "low", w: 0.25 },
      { dim: "ethnicity", key: "german", w: 0.15 },
      { dim: "age", key: "mature", w: 0.1 },
    ],
    civicMultiplier: 1.0,
  },
  intelligentsia: {
    weights: [
      { dim: "education", key: "university", w: 0.45 },
      { dim: "income", key: "middle", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "age", key: "mid", w: 0.1 },
    ],
    civicMultiplier: 1.0,
  },
  christian_milieu: {
    weights: [
      { dim: "age", key: "senior", w: 0.35 },
      { dim: "urbanization", key: "rural", w: 0.3 },
      { dim: "education", key: "primary_or_below", w: 0.2 },
      { dim: "ethnicity", key: "german", w: 0.15 },
    ],
    civicMultiplier: 0.95,
  },
  youth: {
    weights: [
      { dim: "age", key: "young", w: 0.55 },
      { dim: "education", key: "vocational", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.2 },
    ],
    civicMultiplier: 0.9,
  },
};

const DEFAULT_LEANS: Record<GroupId, { economicLean: number; socialLean: number }> = {
  party_nomenklatura: { economicLean: -3, socialLean: 2 },
  industrial_worker: { economicLean: -3, socialLean: 0 },
  collective_farmer: { economicLean: -2, socialLean: 2 },
  intelligentsia: { economicLean: 0, socialLean: -2 },
  christian_milieu: { economicLean: -1, socialLean: 3 },
  youth: { economicLean: -1, socialLean: -1 },
};

type DimPositions = Record<string, DemographicPosition>;
type EraPositions = Record<string, DimPositions>;

// 1953: the nascent, un-consolidated GDR. The June 17 1953 workers' uprising has
// just been crushed by Soviet tanks; the SED is not yet the total state of 1979.
// vs POSITIONS_1979: workers/skilled labour are more restive (less reliably
// statist), the intelligentsia and remaining private professionals pull harder
// toward reform/market, farmers are pre-full-collectivisation and more independent,
// and the older Christian milieu is larger and more assertive.
const POSITIONS_1953: EraPositions = {
  // Widened so the six Bezirke are politically distinguishable: the previous table
  // spanned 0.5 on the economic axis, which this derivation compresses to a 0.10
  // spread across the whole country — every region identical, and the home-region
  // choice meaningless.
  //
  // Urbanization is the lever the census actually offers (Δ63 between East Berlin
  // and Mecklenburg). The 1953 politics are real: the June 17 rising had just been
  // put down in the industrial cities, so urban workers are the least reliably
  // statist, while the countryside was not yet fully collectivised and the private
  // artisan and professional remnant still existed.
  ethnicity: {
    german: { economicLean: -0.5, socialLean: 1.0 },
    other: { economicLean: -0.5, socialLean: 0.5 }, // Expelled Silesians/Sudeten Germans, traditional
  },
  age: {
    young: { economicLean: -1.2, socialLean: -1.8 }, // FDJ new; restive youth
    mid: { economicLean: -0.8, socialLean: -0.2 },
    mature: { economicLean: 0.2, socialLean: 1.4 },
    senior: { economicLean: 1.4, socialLean: 3.2 }, // Pre-war generation, market memory, traditional
  },
  education: {
    primary_or_below: { economicLean: -1.6, socialLean: 2.2 },
    secondary: { economicLean: -0.8, socialLean: 0.6 },
    vocational: { economicLean: -0.4, socialLean: -0.2 }, // Skilled workers, June-17 restive
    university: { economicLean: 2.4, socialLean: -1.8 }, // Intelligentsia, strongly reform-curious
  },
  income: {
    low: { economicLean: -2.4, socialLean: 0.8 }, // Workers less reliably statist after June 17
    middle: { economicLean: -0.6, socialLean: 0.6 },
    high: { economicLean: 3.4, socialLean: 0.8 }, // Remaining private artisans and professionals
  },
  urbanization: {
    urban: { economicLean: -1.8, socialLean: -1.6 }, // Berlin and the Saxon works; June-17 epicentre
    suburban: { economicLean: -0.4, socialLean: 0.6 },
    rural: { economicLean: 1.6, socialLean: 2.8 }, // Farmers before full collectivisation; most independent
  },
};

const POSITIONS_1979: EraPositions = {
  ethnicity: {
    german: { economicLean: -1.0, socialLean: 1.0 },
    other: { economicLean: -1.0, socialLean: 0.0 },
  },
  age: {
    young: { economicLean: -1.5, socialLean: -1.0 },
    mid: { economicLean: -1.0, socialLean: 0.0 },
    mature: { economicLean: -0.5, socialLean: 1.0 },
    senior: { economicLean: 0.0, socialLean: 2.0 },
  },
  education: {
    primary_or_below: { economicLean: -1.0, socialLean: 1.5 },
    secondary: { economicLean: -1.0, socialLean: 0.5 },
    vocational: { economicLean: -1.0, socialLean: 0.0 },
    university: { economicLean: 0.5, socialLean: -1.0 },
  },
  income: {
    low: { economicLean: -2.0, socialLean: 0.5 },
    middle: { economicLean: -1.0, socialLean: 0.5 },
    high: { economicLean: 1.5, socialLean: 0.5 },
  },
  urbanization: {
    urban: { economicLean: -0.5, socialLean: -0.5 },
    suburban: { economicLean: -0.5, socialLean: 0.5 },
    rural: { economicLean: -0.5, socialLean: 1.5 },
  },
};

const ERA_CENSUS: Partial<Record<EraId, Record<string, DDRegionLayer1>>> = {
  "1953": ddRegionCensusData1953,
  "1979": ddRegionCensusData,
};

const ERA_POSITIONS: Partial<Record<EraId, EraPositions>> = {
  "1953": POSITIONS_1953,
  "1979": POSITIONS_1979,
};

function convertCensus(
  raw: Record<string, DDRegionLayer1>
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

export function getDdModel(era: EraId): CountryLayer1Model {
  const census = ERA_CENSUS[era] ?? ddRegionCensusData;
  const positions = ERA_POSITIONS[era] ?? POSITIONS_1979;
  return {
    countryId: "DD",
    categoryId: "dd_voterGroups",
    groupIds: [...DD_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: TURNOUT_RATES,
    positions,
    composition: COMPOSITION as Record<string, CountryLayer1Model["composition"][string]>,
    defaultLeans: DEFAULT_LEANS as Record<string, { economicLean: number; socialLean: number }>,
    census: convertCensus(census),
  };
}

export const ddLayer1Model: CountryLayer1Model = getDdModel("1979");
export const ddGroupIds = [...DD_GROUP_IDS];
