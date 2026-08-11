/**
 * Wales per-macro-region census profiles (Layer-1), by reset era. Mirrors
 * {@link ukRegionCensusData} (ethnicity / age / education / income /
 * urbanization), differentiated across the six Senedd macro-regions: Cardiff
 * diverse/graduate, the Valleys post-industrial/deprived, Mid + North West Wales
 * deeply rural and Welsh-speaking, Swansea mixed, the North East border
 * post-industrial. Each category sums to 100; the population-weighted average
 * tracks the national Wales census.
 */
import type { UKRegionLayer1 } from "@/lib/seeds/uk/ukRegionCensusData";

export const walRegionCensusData: Record<string, UKRegionLayer1> = {
  CDF: {
    ethnicity: { white_british: 84, asian_british: 7, black_british: 3, mixed: 4, other: 2 },
    age: { young: 19, mid: 25, mature: 29, senior: 27 },
    education: {
      no_qualifications: 10,
      gcse_equivalent: 27,
      a_level_equivalent: 26,
      degree_plus: 37,
    },
    income: { low: 27, middle: 51, high: 22 },
    urbanization: { urban: 62, suburban: 25, rural: 13 },
  },
  SWA: {
    ethnicity: { white_british: 93, asian_british: 3, black_british: 1, mixed: 2, other: 1 },
    age: { young: 16, mid: 23, mature: 30, senior: 31 },
    education: {
      no_qualifications: 14,
      gcse_equivalent: 30,
      a_level_equivalent: 25,
      degree_plus: 31,
    },
    income: { low: 30, middle: 52, high: 18 },
    urbanization: { urban: 45, suburban: 28, rural: 27 },
  },
  VAL: {
    ethnicity: { white_british: 97, asian_british: 1, black_british: 0, mixed: 1, other: 1 },
    age: { young: 15, mid: 22, mature: 31, senior: 32 },
    education: {
      no_qualifications: 19,
      gcse_equivalent: 33,
      a_level_equivalent: 24,
      degree_plus: 24,
    },
    income: { low: 36, middle: 51, high: 13 },
    urbanization: { urban: 47, suburban: 33, rural: 20 },
  },
  MWA: {
    ethnicity: { white_british: 97, asian_british: 1, black_british: 0, mixed: 1, other: 1 },
    age: { young: 13, mid: 21, mature: 31, senior: 35 },
    education: {
      no_qualifications: 13,
      gcse_equivalent: 29,
      a_level_equivalent: 27,
      degree_plus: 31,
    },
    income: { low: 29, middle: 54, high: 17 },
    urbanization: { urban: 16, suburban: 22, rural: 62 },
  },
  NWW: {
    ethnicity: { white_british: 96, asian_british: 1, black_british: 1, mixed: 1, other: 1 },
    age: { young: 15, mid: 21, mature: 30, senior: 34 },
    education: {
      no_qualifications: 14,
      gcse_equivalent: 30,
      a_level_equivalent: 26,
      degree_plus: 30,
    },
    income: { low: 31, middle: 53, high: 16 },
    urbanization: { urban: 28, suburban: 24, rural: 48 },
  },
  NEW: {
    ethnicity: { white_british: 95, asian_british: 2, black_british: 1, mixed: 1, other: 1 },
    age: { young: 16, mid: 23, mature: 31, senior: 30 },
    education: {
      no_qualifications: 16,
      gcse_equivalent: 31,
      a_level_equivalent: 25,
      degree_plus: 28,
    },
    income: { low: 30, middle: 53, high: 17 },
    urbanization: { urban: 44, suburban: 34, rural: 22 },
  },
};

export const walRegionCensusData1991: Record<string, UKRegionLayer1> = {
  CDF: {
    ethnicity: { white_british: 93, asian_british: 3, black_british: 2, mixed: 1, other: 1 },
    age: { young: 22, mid: 23, mature: 32, senior: 23 },
    education: {
      no_qualifications: 33,
      gcse_equivalent: 28,
      a_level_equivalent: 20,
      degree_plus: 19,
    },
    income: { low: 27, middle: 54, high: 19 },
    urbanization: { urban: 58, suburban: 28, rural: 14 },
  },
  SWA: {
    ethnicity: { white_british: 97, asian_british: 1, black_british: 1, mixed: 1, other: 0 },
    age: { young: 18, mid: 22, mature: 33, senior: 27 },
    education: {
      no_qualifications: 43,
      gcse_equivalent: 29,
      a_level_equivalent: 16,
      degree_plus: 12,
    },
    income: { low: 30, middle: 54, high: 16 },
    urbanization: { urban: 40, suburban: 32, rural: 28 },
  },
  VAL: {
    ethnicity: { white_british: 99, asian_british: 1, black_british: 0, mixed: 0, other: 0 },
    age: { young: 18, mid: 22, mature: 33, senior: 27 },
    education: {
      no_qualifications: 50,
      gcse_equivalent: 29,
      a_level_equivalent: 13,
      degree_plus: 8,
    },
    income: { low: 35, middle: 53, high: 12 },
    urbanization: { urban: 44, suburban: 34, rural: 22 },
  },
  MWA: {
    ethnicity: { white_british: 99, asian_british: 0, black_british: 0, mixed: 1, other: 0 },
    age: { young: 16, mid: 21, mature: 34, senior: 29 },
    education: {
      no_qualifications: 40,
      gcse_equivalent: 28,
      a_level_equivalent: 18,
      degree_plus: 14,
    },
    income: { low: 30, middle: 55, high: 15 },
    urbanization: { urban: 12, suburban: 24, rural: 64 },
  },
  NWW: {
    ethnicity: { white_british: 98, asian_british: 1, black_british: 0, mixed: 1, other: 0 },
    age: { young: 17, mid: 21, mature: 33, senior: 29 },
    education: {
      no_qualifications: 43,
      gcse_equivalent: 29,
      a_level_equivalent: 16,
      degree_plus: 12,
    },
    income: { low: 31, middle: 54, high: 15 },
    urbanization: { urban: 24, suburban: 26, rural: 50 },
  },
  NEW: {
    ethnicity: { white_british: 98, asian_british: 1, black_british: 1, mixed: 0, other: 0 },
    age: { young: 18, mid: 22, mature: 33, senior: 27 },
    education: {
      no_qualifications: 45,
      gcse_equivalent: 30,
      a_level_equivalent: 15,
      degree_plus: 10,
    },
    income: { low: 30, middle: 54, high: 16 },
    urbanization: { urban: 40, suburban: 34, rural: 26 },
  },
};
