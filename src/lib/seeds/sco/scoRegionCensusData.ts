/**
 * Scotland per-macro-region census profiles (Layer-1), by reset era. Mirrors
 * {@link ukRegionCensusData} (ethnicity / age / education / income /
 * urbanization), differentiated across the seven Holyrood macro-regions:
 * Glasgow urban/diverse, Edinburgh affluent/graduate, the Highlands rural/older,
 * Aberdeen energy-prosperous, Central Scotland post-industrial, the South rural
 * + ex-mining, Tayside mixed. Each category sums to 100; the population-weighted
 * average tracks the national Scotland census.
 */
import type { UKRegionLayer1 } from "@/lib/seeds/uk/ukRegionCensusData";

export const scoRegionCensusData: Record<string, UKRegionLayer1> = {
  GLA: {
    ethnicity: { white_british: 84, asian_british: 8, black_british: 3, mixed: 3, other: 2 },
    age: { young: 21, mid: 27, mature: 28, senior: 24 },
    education: {
      no_qualifications: 12,
      gcse_equivalent: 25,
      a_level_equivalent: 27,
      degree_plus: 36,
    },
    income: { low: 32, middle: 49, high: 19 },
    urbanization: { urban: 93, suburban: 5, rural: 2 },
  },
  LOT: {
    ethnicity: { white_british: 89, asian_british: 6, black_british: 1, mixed: 2, other: 2 },
    age: { young: 20, mid: 27, mature: 28, senior: 25 },
    education: {
      no_qualifications: 6,
      gcse_equivalent: 19,
      a_level_equivalent: 27,
      degree_plus: 48,
    },
    income: { low: 19, middle: 51, high: 30 },
    urbanization: { urban: 82, suburban: 13, rural: 5 },
  },
  HIG: {
    ethnicity: { white_british: 97, asian_british: 1, black_british: 0, mixed: 1, other: 1 },
    age: { young: 14, mid: 22, mature: 32, senior: 32 },
    education: {
      no_qualifications: 10,
      gcse_equivalent: 27,
      a_level_equivalent: 30,
      degree_plus: 33,
    },
    income: { low: 25, middle: 54, high: 21 },
    urbanization: { urban: 33, suburban: 17, rural: 50 },
  },
  GRA: {
    ethnicity: { white_british: 92, asian_british: 3, black_british: 1, mixed: 2, other: 2 },
    age: { young: 16, mid: 27, mature: 30, senior: 27 },
    education: {
      no_qualifications: 8,
      gcse_equivalent: 23,
      a_level_equivalent: 28,
      degree_plus: 41,
    },
    income: { low: 20, middle: 51, high: 29 },
    urbanization: { urban: 58, suburban: 22, rural: 20 },
  },
  TAY: {
    ethnicity: { white_british: 93, asian_british: 3, black_british: 1, mixed: 2, other: 1 },
    age: { young: 17, mid: 24, mature: 30, senior: 29 },
    education: {
      no_qualifications: 9,
      gcse_equivalent: 24,
      a_level_equivalent: 28,
      degree_plus: 39,
    },
    income: { low: 24, middle: 52, high: 24 },
    urbanization: { urban: 62, suburban: 19, rural: 19 },
  },
  STH: {
    ethnicity: { white_british: 96, asian_british: 2, black_british: 0, mixed: 1, other: 1 },
    age: { young: 14, mid: 22, mature: 32, senior: 32 },
    education: {
      no_qualifications: 11,
      gcse_equivalent: 28,
      a_level_equivalent: 29,
      degree_plus: 32,
    },
    income: { low: 27, middle: 54, high: 19 },
    urbanization: { urban: 45, suburban: 22, rural: 33 },
  },
  CSC: {
    ethnicity: { white_british: 95, asian_british: 2, black_british: 1, mixed: 1, other: 1 },
    age: { young: 17, mid: 24, mature: 31, senior: 28 },
    education: {
      no_qualifications: 12,
      gcse_equivalent: 28,
      a_level_equivalent: 28,
      degree_plus: 32,
    },
    income: { low: 27, middle: 52, high: 21 },
    urbanization: { urban: 81, suburban: 12, rural: 7 },
  },
};

export const scoRegionCensusData1991: Record<string, UKRegionLayer1> = {
  GLA: {
    ethnicity: { white_british: 95, asian_british: 3, black_british: 1, mixed: 1, other: 0 },
    age: { young: 23, mid: 23, mature: 33, senior: 21 },
    education: {
      no_qualifications: 45,
      gcse_equivalent: 28,
      a_level_equivalent: 15,
      degree_plus: 12,
    },
    income: { low: 36, middle: 51, high: 13 },
    urbanization: { urban: 70, suburban: 18, rural: 12 },
  },
  LOT: {
    ethnicity: { white_british: 97, asian_british: 2, black_british: 0, mixed: 1, other: 0 },
    age: { young: 22, mid: 24, mature: 31, senior: 23 },
    education: {
      no_qualifications: 28,
      gcse_equivalent: 27,
      a_level_equivalent: 22,
      degree_plus: 23,
    },
    income: { low: 22, middle: 54, high: 24 },
    urbanization: { urban: 58, suburban: 28, rural: 14 },
  },
  HIG: {
    ethnicity: { white_british: 99, asian_british: 0, black_british: 0, mixed: 1, other: 0 },
    age: { young: 16, mid: 22, mature: 34, senior: 28 },
    education: {
      no_qualifications: 42,
      gcse_equivalent: 28,
      a_level_equivalent: 16,
      degree_plus: 14,
    },
    income: { low: 29, middle: 54, high: 17 },
    urbanization: { urban: 25, suburban: 23, rural: 52 },
  },
  GRA: {
    ethnicity: { white_british: 98, asian_british: 1, black_british: 0, mixed: 1, other: 0 },
    age: { young: 18, mid: 24, mature: 34, senior: 24 },
    education: {
      no_qualifications: 35,
      gcse_equivalent: 28,
      a_level_equivalent: 20,
      degree_plus: 17,
    },
    income: { low: 24, middle: 54, high: 22 },
    urbanization: { urban: 44, suburban: 29, rural: 27 },
  },
  TAY: {
    ethnicity: { white_british: 98, asian_british: 1, black_british: 0, mixed: 1, other: 0 },
    age: { young: 19, mid: 23, mature: 33, senior: 25 },
    education: {
      no_qualifications: 38,
      gcse_equivalent: 28,
      a_level_equivalent: 19,
      degree_plus: 15,
    },
    income: { low: 27, middle: 54, high: 19 },
    urbanization: { urban: 48, suburban: 29, rural: 23 },
  },
  STH: {
    ethnicity: { white_british: 99, asian_british: 1, black_british: 0, mixed: 0, other: 0 },
    age: { young: 16, mid: 22, mature: 34, senior: 28 },
    education: {
      no_qualifications: 41,
      gcse_equivalent: 29,
      a_level_equivalent: 18,
      degree_plus: 12,
    },
    income: { low: 30, middle: 54, high: 16 },
    urbanization: { urban: 36, suburban: 30, rural: 34 },
  },
  CSC: {
    ethnicity: { white_british: 98, asian_british: 1, black_british: 0, mixed: 1, other: 0 },
    age: { young: 20, mid: 23, mature: 33, senior: 24 },
    education: {
      no_qualifications: 44,
      gcse_equivalent: 29,
      a_level_equivalent: 15,
      degree_plus: 12,
    },
    income: { low: 30, middle: 54, high: 16 },
    urbanization: { urban: 60, suburban: 29, rural: 11 },
  },
};
