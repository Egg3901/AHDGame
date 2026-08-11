/**
 * United Kingdom Region Census Profiles — 1991 era.
 *
 * 1991-default companion to {@link ukRegionCensusData} (the 2019 profiles).
 * Selected at render time via the preset registry under the `1991-default`
 * reset preset.
 *
 * Sources / methodology (approximate, % of adult population): 1991 UK Census
 * (the first to ask an ethnic-group question). Outside London the population
 * was overwhelmingly White British; tertiary attainment was far lower than
 * today and "no qualifications" much higher. Income uses era-neutral relative
 * tiers (no £ thresholds).
 *
 * Directional vs the 2019 profiles: higher `white_british`, lower
 * `degree_plus`, higher `no_qualifications`.
 */

import type { UKRegionLayer1 } from "./ukRegionCensusData";

export const ukRegionCensusData1991: Record<string, UKRegionLayer1> = {
  LON: {
    ethnicity: { white_british: 80, asian_british: 9, black_british: 7, mixed: 2, other: 2 },
    age: { young: 22, mid: 26, mature: 31, senior: 21 },
    education: {
      no_qualifications: 32,
      gcse_equivalent: 28,
      a_level_equivalent: 22,
      degree_plus: 18,
    },
    income: { low: 26, middle: 50, high: 24 },
    urbanization: { urban: 95, suburban: 5, rural: 0 },
  },
  SEE: {
    ethnicity: { white_british: 93, asian_british: 3, black_british: 1, mixed: 1, other: 2 },
    age: { young: 19, mid: 24, mature: 33, senior: 24 },
    education: {
      no_qualifications: 34,
      gcse_equivalent: 28,
      a_level_equivalent: 21,
      degree_plus: 17,
    },
    income: { low: 20, middle: 53, high: 27 },
    urbanization: { urban: 55, suburban: 33, rural: 12 },
  },
  SWE: {
    ethnicity: { white_british: 97, asian_british: 1, black_british: 0, mixed: 1, other: 1 },
    age: { young: 18, mid: 22, mature: 34, senior: 26 },
    education: {
      no_qualifications: 38,
      gcse_equivalent: 28,
      a_level_equivalent: 19,
      degree_plus: 15,
    },
    income: { low: 24, middle: 54, high: 22 },
    urbanization: { urban: 38, suburban: 32, rural: 30 },
  },
  EAE: {
    ethnicity: { white_british: 94, asian_british: 3, black_british: 1, mixed: 1, other: 1 },
    age: { young: 19, mid: 23, mature: 33, senior: 25 },
    education: {
      no_qualifications: 36,
      gcse_equivalent: 29,
      a_level_equivalent: 20,
      degree_plus: 15,
    },
    income: { low: 22, middle: 54, high: 24 },
    urbanization: { urban: 45, suburban: 33, rural: 22 },
  },
  EMI: {
    ethnicity: { white_british: 92, asian_british: 5, black_british: 1, mixed: 1, other: 1 },
    age: { young: 19, mid: 23, mature: 33, senior: 25 },
    education: {
      no_qualifications: 40,
      gcse_equivalent: 29,
      a_level_equivalent: 18,
      degree_plus: 13,
    },
    income: { low: 26, middle: 54, high: 20 },
    urbanization: { urban: 42, suburban: 33, rural: 25 },
  },
  WMI: {
    ethnicity: { white_british: 88, asian_british: 8, black_british: 2, mixed: 1, other: 1 },
    age: { young: 20, mid: 23, mature: 32, senior: 25 },
    education: {
      no_qualifications: 42,
      gcse_equivalent: 29,
      a_level_equivalent: 17,
      degree_plus: 12,
    },
    income: { low: 28, middle: 54, high: 18 },
    urbanization: { urban: 60, suburban: 28, rural: 12 },
  },
  YHU: {
    ethnicity: { white_british: 92, asian_british: 5, black_british: 1, mixed: 1, other: 1 },
    age: { young: 20, mid: 23, mature: 32, senior: 25 },
    education: {
      no_qualifications: 42,
      gcse_equivalent: 29,
      a_level_equivalent: 17,
      degree_plus: 12,
    },
    income: { low: 28, middle: 54, high: 18 },
    urbanization: { urban: 50, suburban: 30, rural: 20 },
  },
  NWE: {
    ethnicity: { white_british: 92, asian_british: 5, black_british: 1, mixed: 1, other: 1 },
    age: { young: 20, mid: 23, mature: 32, senior: 25 },
    education: {
      no_qualifications: 42,
      gcse_equivalent: 29,
      a_level_equivalent: 17,
      degree_plus: 12,
    },
    income: { low: 28, middle: 54, high: 18 },
    urbanization: { urban: 58, suburban: 30, rural: 12 },
  },
  NEE: {
    ethnicity: { white_british: 97, asian_british: 2, black_british: 0, mixed: 1, other: 0 },
    age: { young: 20, mid: 22, mature: 33, senior: 25 },
    education: {
      no_qualifications: 44,
      gcse_equivalent: 30,
      a_level_equivalent: 16,
      degree_plus: 10,
    },
    income: { low: 32, middle: 53, high: 15 },
    urbanization: { urban: 55, suburban: 30, rural: 15 },
  },
  SCO: {
    ethnicity: { white_british: 98, asian_british: 1, black_british: 0, mixed: 1, other: 0 },
    age: { young: 20, mid: 23, mature: 33, senior: 24 },
    education: {
      no_qualifications: 38,
      gcse_equivalent: 28,
      a_level_equivalent: 19,
      degree_plus: 15,
    },
    income: { low: 28, middle: 53, high: 19 },
    urbanization: { urban: 50, suburban: 28, rural: 22 },
  },
  WAL: {
    ethnicity: { white_british: 97, asian_british: 1, black_british: 1, mixed: 1, other: 0 },
    age: { young: 19, mid: 22, mature: 33, senior: 26 },
    education: {
      no_qualifications: 42,
      gcse_equivalent: 29,
      a_level_equivalent: 17,
      degree_plus: 12,
    },
    income: { low: 30, middle: 54, high: 16 },
    urbanization: { urban: 40, suburban: 32, rural: 28 },
  },
  NIR: {
    ethnicity: { white_british: 99, asian_british: 0, black_british: 0, mixed: 1, other: 0 },
    age: { young: 22, mid: 23, mature: 31, senior: 24 },
    education: {
      no_qualifications: 42,
      gcse_equivalent: 28,
      a_level_equivalent: 18,
      degree_plus: 12,
    },
    income: { low: 32, middle: 53, high: 15 },
    urbanization: { urban: 50, suburban: 25, rural: 25 },
  },
};
