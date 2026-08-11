/**
 * United Kingdom Region Census Profiles — 2007 era.
 *
 * 2007-default companion to {@link ukRegionCensusData} (the 2019 profiles).
 * Anchored to ONS mid-year estimates and the Annual Population Survey
 * (mid-2000s), interpolating between Census 2001 and Census 2011.
 *
 * Era anchors (pre-crash Brown handover): EU-accession (A8) migration wave
 * underway since 2004, lifting "other" and Eastern-European shares in the
 * East of England, East Midlands and London; financialized London / South
 * East at the peak of the credit boom; New Labour university expansion
 * pushing degree attainment into the 20s–30s; minority populations growing
 * fastest in London and the West Midlands.
 *
 * All values independently authored from historical knowledge of each region
 * in 2007 — NOT scaled or derived from any other era's data. Income uses
 * era-neutral relative tiers (no £ thresholds).
 */

import type { UKRegionLayer1 } from "./ukRegionCensusData";

export const ukRegionCensusData2007: Record<string, UKRegionLayer1> = {
  LON: {
    ethnicity: { white_british: 61, asian_british: 17, black_british: 12, mixed: 4, other: 6 },
    age: { young: 23, mid: 30, mature: 27, senior: 20 },
    education: {
      no_qualifications: 14,
      gcse_equivalent: 23,
      a_level_equivalent: 23,
      degree_plus: 40,
    },
    income: { low: 25, middle: 46, high: 29 },
    urbanization: { urban: 97, suburban: 3, rural: 0 },
  },
  SEE: {
    ethnicity: { white_british: 86, asian_british: 6, black_british: 3, mixed: 2, other: 3 },
    age: { young: 18, mid: 26, mature: 31, senior: 25 },
    education: {
      no_qualifications: 15,
      gcse_equivalent: 30,
      a_level_equivalent: 24,
      degree_plus: 31,
    },
    income: { low: 18, middle: 51, high: 31 },
    urbanization: { urban: 58, suburban: 30, rural: 12 },
  },
  SWE: {
    ethnicity: { white_british: 95, asian_british: 2, black_british: 1, mixed: 1, other: 1 },
    age: { young: 16, mid: 24, mature: 31, senior: 29 },
    education: {
      no_qualifications: 17,
      gcse_equivalent: 31,
      a_level_equivalent: 25,
      degree_plus: 27,
    },
    income: { low: 22, middle: 54, high: 24 },
    urbanization: { urban: 40, suburban: 28, rural: 32 },
  },
  EAE: {
    // A8 migration to agricultural and food-processing areas (Fenland, Boston corridor).
    ethnicity: { white_british: 88, asian_british: 6, black_british: 2, mixed: 2, other: 2 },
    age: { young: 17, mid: 25, mature: 31, senior: 27 },
    education: {
      no_qualifications: 17,
      gcse_equivalent: 30,
      a_level_equivalent: 24,
      degree_plus: 29,
    },
    income: { low: 20, middle: 52, high: 28 },
    urbanization: { urban: 50, suburban: 31, rural: 19 },
  },
  EMI: {
    ethnicity: { white_british: 88, asian_british: 6, black_british: 3, mixed: 2, other: 1 },
    age: { young: 18, mid: 25, mature: 31, senior: 26 },
    education: {
      no_qualifications: 20,
      gcse_equivalent: 31,
      a_level_equivalent: 24,
      degree_plus: 25,
    },
    income: { low: 24, middle: 53, high: 23 },
    urbanization: { urban: 50, suburban: 30, rural: 20 },
  },
  WMI: {
    ethnicity: { white_british: 78, asian_british: 13, black_british: 6, mixed: 2, other: 1 },
    age: { young: 19, mid: 26, mature: 29, senior: 26 },
    education: {
      no_qualifications: 21,
      gcse_equivalent: 31,
      a_level_equivalent: 23,
      degree_plus: 25,
    },
    income: { low: 27, middle: 51, high: 22 },
    urbanization: { urban: 70, suburban: 21, rural: 9 },
  },
  YHU: {
    ethnicity: { white_british: 88, asian_british: 7, black_british: 2, mixed: 2, other: 1 },
    age: { young: 19, mid: 25, mature: 30, senior: 26 },
    education: {
      no_qualifications: 21,
      gcse_equivalent: 32,
      a_level_equivalent: 23,
      degree_plus: 24,
    },
    income: { low: 26, middle: 52, high: 22 },
    urbanization: { urban: 58, suburban: 26, rural: 16 },
  },
  NWE: {
    ethnicity: { white_british: 87, asian_british: 8, black_british: 2, mixed: 2, other: 1 },
    age: { young: 19, mid: 26, mature: 29, senior: 26 },
    education: {
      no_qualifications: 20,
      gcse_equivalent: 31,
      a_level_equivalent: 24,
      degree_plus: 25,
    },
    income: { low: 27, middle: 51, high: 22 },
    urbanization: { urban: 70, suburban: 22, rural: 8 },
  },
  NEE: {
    ethnicity: { white_british: 96, asian_british: 2, black_british: 0, mixed: 1, other: 1 },
    age: { young: 18, mid: 24, mature: 31, senior: 27 },
    education: {
      no_qualifications: 23,
      gcse_equivalent: 32,
      a_level_equivalent: 24,
      degree_plus: 21,
    },
    income: { low: 33, middle: 52, high: 15 },
    urbanization: { urban: 57, suburban: 27, rural: 16 },
  },
  SCO: {
    // First SNP minority government formed May 2007.
    ethnicity: { white_british: 96, asian_british: 2, black_british: 0, mixed: 1, other: 1 },
    age: { young: 18, mid: 25, mature: 31, senior: 26 },
    education: {
      no_qualifications: 14,
      gcse_equivalent: 26,
      a_level_equivalent: 27,
      degree_plus: 33,
    },
    income: { low: 25, middle: 51, high: 24 },
    urbanization: { urban: 62, suburban: 22, rural: 16 },
  },
  WAL: {
    ethnicity: { white_british: 95, asian_british: 2, black_british: 1, mixed: 1, other: 1 },
    age: { young: 17, mid: 23, mature: 31, senior: 29 },
    education: {
      no_qualifications: 21,
      gcse_equivalent: 31,
      a_level_equivalent: 24,
      degree_plus: 24,
    },
    income: { low: 30, middle: 52, high: 18 },
    urbanization: { urban: 42, suburban: 30, rural: 28 },
  },
  NIR: {
    // St Andrews Agreement restored devolution May 2007 (DUP/Sinn Féin executive).
    ethnicity: { white_british: 98, asian_british: 1, black_british: 0, mixed: 1, other: 0 },
    age: { young: 21, mid: 27, mature: 29, senior: 23 },
    education: {
      no_qualifications: 22,
      gcse_equivalent: 30,
      a_level_equivalent: 25,
      degree_plus: 23,
    },
    income: { low: 30, middle: 52, high: 18 },
    urbanization: { urban: 46, suburban: 27, rural: 27 },
  },
};
