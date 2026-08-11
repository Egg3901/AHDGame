/**
 * United Kingdom Region Census Profiles — 1979 era.
 *
 * 1979-default companion to {@link ukRegionCensusData} (the 2019 profiles).
 * Anchored to the UK Census 1981 (the 1991 census was the first with an
 * ethnic-group question, so 1981-era ethnicity is estimated from country-of-
 * birth tables and Labour Force Survey work).
 *
 * Era anchors (Winter of Discontent / Thatcher's first win): industrial
 * North, Midlands, Scotland and Wales at or near their manufacturing peak;
 * council-housing tenure at its historic high; higher-education attainment
 * very low (degree-level under ~10% everywhere); ethnic-minority population
 * concentrated almost entirely in London and the West Midlands; Northern
 * Ireland mid-Troubles with a notably young population.
 *
 * All values independently authored from historical knowledge of each region
 * in 1979 — NOT scaled or derived from any other era's data. Income uses
 * era-neutral relative tiers (no £ thresholds).
 */

import type { UKRegionLayer1 } from "./ukRegionCensusData";

export const ukRegionCensusData1979: Record<string, UKRegionLayer1> = {
  LON: {
    ethnicity: { white_british: 87, asian_british: 6, black_british: 5, mixed: 1, other: 1 },
    age: { young: 24, mid: 26, mature: 30, senior: 20 },
    education: {
      no_qualifications: 42,
      gcse_equivalent: 28,
      a_level_equivalent: 19,
      degree_plus: 11,
    },
    income: { low: 26, middle: 52, high: 22 },
    urbanization: { urban: 96, suburban: 4, rural: 0 },
  },
  SEE: {
    ethnicity: { white_british: 96, asian_british: 2, black_british: 1, mixed: 0, other: 1 },
    age: { young: 20, mid: 24, mature: 33, senior: 23 },
    education: {
      no_qualifications: 44,
      gcse_equivalent: 28,
      a_level_equivalent: 18,
      degree_plus: 10,
    },
    income: { low: 20, middle: 55, high: 25 },
    urbanization: { urban: 52, suburban: 34, rural: 14 },
  },
  SWE: {
    ethnicity: { white_british: 98, asian_british: 1, black_british: 0, mixed: 1, other: 0 },
    age: { young: 19, mid: 22, mature: 34, senior: 25 },
    education: {
      no_qualifications: 48,
      gcse_equivalent: 27,
      a_level_equivalent: 16,
      degree_plus: 9,
    },
    income: { low: 25, middle: 55, high: 20 },
    urbanization: { urban: 36, suburban: 32, rural: 32 },
  },
  EAE: {
    ethnicity: { white_british: 97, asian_british: 2, black_british: 0, mixed: 1, other: 0 },
    age: { young: 20, mid: 23, mature: 33, senior: 24 },
    education: {
      no_qualifications: 46,
      gcse_equivalent: 28,
      a_level_equivalent: 17,
      degree_plus: 9,
    },
    income: { low: 23, middle: 55, high: 22 },
    urbanization: { urban: 42, suburban: 33, rural: 25 },
  },
  EMI: {
    ethnicity: { white_british: 95, asian_british: 4, black_british: 0, mixed: 1, other: 0 },
    age: { young: 21, mid: 23, mature: 33, senior: 23 },
    education: {
      no_qualifications: 50,
      gcse_equivalent: 27,
      a_level_equivalent: 15,
      degree_plus: 8,
    },
    income: { low: 26, middle: 55, high: 19 },
    urbanization: { urban: 40, suburban: 33, rural: 27 },
  },
  WMI: {
    // Birmingham/Black Country car-and-metal manufacturing at peak employment;
    // largest South Asian and Caribbean communities outside London.
    ethnicity: { white_british: 90, asian_british: 7, black_british: 2, mixed: 1, other: 0 },
    age: { young: 21, mid: 24, mature: 32, senior: 23 },
    education: {
      no_qualifications: 52,
      gcse_equivalent: 27,
      a_level_equivalent: 14,
      degree_plus: 7,
    },
    income: { low: 25, middle: 56, high: 19 },
    urbanization: { urban: 62, suburban: 27, rural: 11 },
  },
  YHU: {
    ethnicity: { white_british: 95, asian_british: 4, black_british: 0, mixed: 1, other: 0 },
    age: { young: 21, mid: 23, mature: 32, senior: 24 },
    education: {
      no_qualifications: 52,
      gcse_equivalent: 27,
      a_level_equivalent: 14,
      degree_plus: 7,
    },
    income: { low: 28, middle: 54, high: 18 },
    urbanization: { urban: 52, suburban: 30, rural: 18 },
  },
  NWE: {
    ethnicity: { white_british: 95, asian_british: 3, black_british: 1, mixed: 1, other: 0 },
    age: { young: 21, mid: 24, mature: 32, senior: 23 },
    education: {
      no_qualifications: 52,
      gcse_equivalent: 27,
      a_level_equivalent: 14,
      degree_plus: 7,
    },
    income: { low: 28, middle: 54, high: 18 },
    urbanization: { urban: 62, suburban: 28, rural: 10 },
  },
  NEE: {
    // Shipbuilding, coal and steel still dominant employers in 1979.
    ethnicity: { white_british: 99, asian_british: 1, black_british: 0, mixed: 0, other: 0 },
    age: { young: 21, mid: 23, mature: 33, senior: 23 },
    education: {
      no_qualifications: 55,
      gcse_equivalent: 27,
      a_level_equivalent: 12,
      degree_plus: 6,
    },
    income: { low: 33, middle: 52, high: 15 },
    urbanization: { urban: 58, suburban: 28, rural: 14 },
  },
  SCO: {
    ethnicity: { white_british: 99, asian_british: 1, black_british: 0, mixed: 0, other: 0 },
    age: { young: 22, mid: 24, mature: 32, senior: 22 },
    education: {
      no_qualifications: 48,
      gcse_equivalent: 27,
      a_level_equivalent: 16,
      degree_plus: 9,
    },
    income: { low: 30, middle: 52, high: 18 },
    urbanization: { urban: 52, suburban: 27, rural: 21 },
  },
  WAL: {
    ethnicity: { white_british: 98, asian_british: 1, black_british: 0, mixed: 1, other: 0 },
    age: { young: 20, mid: 22, mature: 33, senior: 25 },
    education: {
      no_qualifications: 52,
      gcse_equivalent: 27,
      a_level_equivalent: 14,
      degree_plus: 7,
    },
    income: { low: 31, middle: 53, high: 16 },
    urbanization: { urban: 42, suburban: 30, rural: 28 },
  },
  NIR: {
    // Mid-Troubles; highest birth rate and youngest age profile in the UK.
    ethnicity: { white_british: 100, asian_british: 0, black_british: 0, mixed: 0, other: 0 },
    age: { young: 24, mid: 24, mature: 30, senior: 22 },
    education: {
      no_qualifications: 52,
      gcse_equivalent: 26,
      a_level_equivalent: 14,
      degree_plus: 8,
    },
    income: { low: 35, middle: 50, high: 15 },
    urbanization: { urban: 48, suburban: 26, rural: 26 },
  },
};
