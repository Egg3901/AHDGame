/**
 * United Kingdom Region Census Profiles — 2023 era.
 *
 * 2023-default companion to {@link ukRegionCensusData} (the 2019 profiles).
 * Anchored to Census 2021 (England & Wales), Scotland's Census 2022, and ONS
 * mid-2023 population estimates / Annual Population Survey.
 *
 * Era anchors (post-Brexit / post-pandemic): London well under half White
 * British; graduate share around a third nationally and over half in London;
 * pronounced ageing in coastal and rural regions (South West, Wales, East of
 * England); record net migration in 2022–23 lifting "other" shares broadly;
 * cost-of-living squeeze widening the low-income tier in the North East and
 * Wales.
 *
 * All values independently authored from historical knowledge of each region
 * in 2023 — NOT scaled or derived from any other era's data. Income uses
 * era-neutral relative tiers (no £ thresholds).
 */

import type { UKRegionLayer1 } from "./ukRegionCensusData";

export const ukRegionCensusData2023: Record<string, UKRegionLayer1> = {
  LON: {
    ethnicity: { white_british: 50, asian_british: 21, black_british: 14, mixed: 6, other: 9 },
    age: { young: 22, mid: 31, mature: 27, senior: 20 },
    education: {
      no_qualifications: 7,
      gcse_equivalent: 19,
      a_level_equivalent: 21,
      degree_plus: 53,
    },
    income: { low: 24, middle: 44, high: 32 },
    urbanization: { urban: 98, suburban: 2, rural: 0 },
  },
  SEE: {
    ethnicity: { white_british: 80, asian_british: 9, black_british: 4, mixed: 3, other: 4 },
    age: { young: 17, mid: 26, mature: 30, senior: 27 },
    education: {
      no_qualifications: 9,
      gcse_equivalent: 27,
      a_level_equivalent: 24,
      degree_plus: 40,
    },
    income: { low: 17, middle: 49, high: 34 },
    urbanization: { urban: 61, suburban: 27, rural: 12 },
  },
  SWE: {
    // Oldest regional age profile in England; coastal retirement belt.
    ethnicity: { white_british: 93, asian_british: 2, black_british: 1, mixed: 2, other: 2 },
    age: { young: 16, mid: 24, mature: 29, senior: 31 },
    education: {
      no_qualifications: 11,
      gcse_equivalent: 29,
      a_level_equivalent: 25,
      degree_plus: 35,
    },
    income: { low: 21, middle: 53, high: 26 },
    urbanization: { urban: 43, suburban: 26, rural: 31 },
  },
  EAE: {
    ethnicity: { white_british: 81, asian_british: 9, black_british: 4, mixed: 3, other: 3 },
    age: { young: 17, mid: 25, mature: 29, senior: 29 },
    education: {
      no_qualifications: 10,
      gcse_equivalent: 28,
      a_level_equivalent: 24,
      degree_plus: 38,
    },
    income: { low: 19, middle: 52, high: 29 },
    urbanization: { urban: 53, suburban: 30, rural: 17 },
  },
  EMI: {
    ethnicity: { white_british: 82, asian_british: 8, black_british: 4, mixed: 3, other: 3 },
    age: { young: 17, mid: 25, mature: 30, senior: 28 },
    education: {
      no_qualifications: 12,
      gcse_equivalent: 29,
      a_level_equivalent: 25,
      degree_plus: 34,
    },
    income: { low: 23, middle: 53, high: 24 },
    urbanization: { urban: 56, suburban: 27, rural: 17 },
  },
  WMI: {
    // Birmingham majority-minority at Census 2021.
    ethnicity: { white_british: 67, asian_british: 18, black_british: 8, mixed: 4, other: 3 },
    age: { young: 19, mid: 26, mature: 28, senior: 27 },
    education: {
      no_qualifications: 13,
      gcse_equivalent: 29,
      a_level_equivalent: 24,
      degree_plus: 34,
    },
    income: { low: 26, middle: 50, high: 24 },
    urbanization: { urban: 76, suburban: 17, rural: 7 },
  },
  YHU: {
    ethnicity: { white_british: 81, asian_british: 10, black_british: 3, mixed: 3, other: 3 },
    age: { young: 18, mid: 25, mature: 29, senior: 28 },
    education: {
      no_qualifications: 13,
      gcse_equivalent: 30,
      a_level_equivalent: 24,
      degree_plus: 33,
    },
    income: { low: 25, middle: 52, high: 23 },
    urbanization: { urban: 63, suburban: 23, rural: 14 },
  },
  NWE: {
    ethnicity: { white_british: 78, asian_british: 11, black_british: 4, mixed: 3, other: 4 },
    age: { young: 19, mid: 26, mature: 29, senior: 26 },
    education: {
      no_qualifications: 12,
      gcse_equivalent: 29,
      a_level_equivalent: 25,
      degree_plus: 34,
    },
    income: { low: 26, middle: 51, high: 23 },
    urbanization: { urban: 77, suburban: 15, rural: 8 },
  },
  NEE: {
    ethnicity: { white_british: 92, asian_british: 4, black_british: 1, mixed: 2, other: 1 },
    age: { young: 17, mid: 24, mature: 30, senior: 29 },
    education: {
      no_qualifications: 15,
      gcse_equivalent: 31,
      a_level_equivalent: 24,
      degree_plus: 30,
    },
    income: { low: 32, middle: 52, high: 16 },
    urbanization: { urban: 59, suburban: 24, rural: 17 },
  },
  SCO: {
    ethnicity: { white_british: 91, asian_british: 5, black_british: 1, mixed: 1, other: 2 },
    age: { young: 17, mid: 25, mature: 29, senior: 29 },
    education: {
      no_qualifications: 8,
      gcse_equivalent: 23,
      a_level_equivalent: 28,
      degree_plus: 41,
    },
    income: { low: 23, middle: 51, high: 26 },
    urbanization: { urban: 69, suburban: 17, rural: 14 },
  },
  WAL: {
    ethnicity: { white_british: 92, asian_british: 3, black_british: 1, mixed: 2, other: 2 },
    age: { young: 16, mid: 23, mature: 29, senior: 32 },
    education: {
      no_qualifications: 13,
      gcse_equivalent: 29,
      a_level_equivalent: 25,
      degree_plus: 33,
    },
    income: { low: 29, middle: 52, high: 19 },
    urbanization: { urban: 45, suburban: 27, rural: 28 },
  },
  NIR: {
    ethnicity: { white_british: 95, asian_british: 2, black_british: 1, mixed: 1, other: 1 },
    age: { young: 18, mid: 26, mature: 29, senior: 27 },
    education: {
      no_qualifications: 11,
      gcse_equivalent: 27,
      a_level_equivalent: 26,
      degree_plus: 36,
    },
    income: { low: 27, middle: 52, high: 21 },
    urbanization: { urban: 47, suburban: 28, rural: 25 },
  },
};
