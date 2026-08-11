/**
 * United Kingdom Region Census Profiles — 1999 era.
 *
 * 1999-default companion to {@link ukRegionCensusData} (the 2019 profiles).
 * Anchored to the UK Census 2001 and late-1990s Labour Force Survey data.
 *
 * Era anchors (early Blair government): devolution to Scotland, Wales and
 * Northern Ireland just enacted; "Cool Britannia" London boom and rising
 * diversity in the capital; university expansion only beginning (degree-level
 * attainment in the high teens to mid-20s); deindustrialization largely
 * complete in the North East, South Wales and Clydeside; minimal seniors
 * bulge compared with later eras.
 *
 * All values independently authored from historical knowledge of each region
 * in 1999 — NOT scaled or derived from any other era's data. Income uses
 * era-neutral relative tiers (no £ thresholds).
 */

import type { UKRegionLayer1 } from "./ukRegionCensusData";

export const ukRegionCensusData1999: Record<string, UKRegionLayer1> = {
  LON: {
    ethnicity: { white_british: 70, asian_british: 13, black_british: 10, mixed: 3, other: 4 },
    age: { young: 23, mid: 29, mature: 28, senior: 20 },
    education: {
      no_qualifications: 22,
      gcse_equivalent: 27,
      a_level_equivalent: 24,
      degree_plus: 27,
    },
    income: { low: 26, middle: 48, high: 26 },
    urbanization: { urban: 96, suburban: 4, rural: 0 },
  },
  SEE: {
    ethnicity: { white_british: 90, asian_british: 4, black_british: 2, mixed: 2, other: 2 },
    age: { young: 19, mid: 26, mature: 31, senior: 24 },
    education: {
      no_qualifications: 24,
      gcse_equivalent: 30,
      a_level_equivalent: 24,
      degree_plus: 22,
    },
    income: { low: 19, middle: 52, high: 29 },
    urbanization: { urban: 56, suburban: 32, rural: 12 },
  },
  SWE: {
    ethnicity: { white_british: 97, asian_british: 1, black_british: 0, mixed: 1, other: 1 },
    age: { young: 17, mid: 24, mature: 32, senior: 27 },
    education: {
      no_qualifications: 27,
      gcse_equivalent: 31,
      a_level_equivalent: 23,
      degree_plus: 19,
    },
    income: { low: 23, middle: 54, high: 23 },
    urbanization: { urban: 39, suburban: 30, rural: 31 },
  },
  EAE: {
    ethnicity: { white_british: 92, asian_british: 4, black_british: 2, mixed: 1, other: 1 },
    age: { young: 18, mid: 25, mature: 32, senior: 25 },
    education: {
      no_qualifications: 26,
      gcse_equivalent: 31,
      a_level_equivalent: 23,
      degree_plus: 20,
    },
    income: { low: 21, middle: 53, high: 26 },
    urbanization: { urban: 47, suburban: 32, rural: 21 },
  },
  EMI: {
    ethnicity: { white_british: 90, asian_british: 6, black_british: 2, mixed: 1, other: 1 },
    age: { young: 18, mid: 25, mature: 32, senior: 25 },
    education: {
      no_qualifications: 29,
      gcse_equivalent: 31,
      a_level_equivalent: 22,
      degree_plus: 18,
    },
    income: { low: 25, middle: 54, high: 21 },
    urbanization: { urban: 46, suburban: 31, rural: 23 },
  },
  WMI: {
    ethnicity: { white_british: 84, asian_british: 10, black_british: 4, mixed: 1, other: 1 },
    age: { young: 19, mid: 25, mature: 31, senior: 25 },
    education: {
      no_qualifications: 31,
      gcse_equivalent: 31,
      a_level_equivalent: 21,
      degree_plus: 17,
    },
    income: { low: 27, middle: 53, high: 20 },
    urbanization: { urban: 65, suburban: 25, rural: 10 },
  },
  YHU: {
    ethnicity: { white_british: 90, asian_british: 6, black_british: 2, mixed: 1, other: 1 },
    age: { young: 19, mid: 25, mature: 31, senior: 25 },
    education: {
      no_qualifications: 31,
      gcse_equivalent: 31,
      a_level_equivalent: 21,
      degree_plus: 17,
    },
    income: { low: 27, middle: 53, high: 20 },
    urbanization: { urban: 54, suburban: 28, rural: 18 },
  },
  NWE: {
    ethnicity: { white_british: 90, asian_british: 6, black_british: 2, mixed: 1, other: 1 },
    age: { young: 19, mid: 26, mature: 30, senior: 25 },
    education: {
      no_qualifications: 30,
      gcse_equivalent: 31,
      a_level_equivalent: 22,
      degree_plus: 17,
    },
    income: { low: 28, middle: 52, high: 20 },
    urbanization: { urban: 64, suburban: 26, rural: 10 },
  },
  NEE: {
    ethnicity: { white_british: 97, asian_british: 2, black_british: 0, mixed: 1, other: 0 },
    age: { young: 19, mid: 24, mature: 32, senior: 25 },
    education: {
      no_qualifications: 34,
      gcse_equivalent: 31,
      a_level_equivalent: 21,
      degree_plus: 14,
    },
    income: { low: 33, middle: 52, high: 15 },
    urbanization: { urban: 56, suburban: 28, rural: 16 },
  },
  SCO: {
    // First Scottish Parliament elections held May 1999.
    ethnicity: { white_british: 97, asian_british: 2, black_british: 0, mixed: 1, other: 0 },
    age: { young: 19, mid: 25, mature: 32, senior: 24 },
    education: {
      no_qualifications: 26,
      gcse_equivalent: 28,
      a_level_equivalent: 24,
      degree_plus: 22,
    },
    income: { low: 27, middle: 52, high: 21 },
    urbanization: { urban: 56, suburban: 26, rural: 18 },
  },
  WAL: {
    // First National Assembly for Wales elections held May 1999.
    ethnicity: { white_british: 96, asian_british: 2, black_british: 1, mixed: 1, other: 0 },
    age: { young: 17, mid: 23, mature: 32, senior: 28 },
    education: {
      no_qualifications: 31,
      gcse_equivalent: 31,
      a_level_equivalent: 21,
      degree_plus: 17,
    },
    income: { low: 30, middle: 53, high: 17 },
    urbanization: { urban: 41, suburban: 31, rural: 28 },
  },
  NIR: {
    // Good Friday Agreement signed 1998; Assembly newly devolved.
    ethnicity: { white_british: 99, asian_british: 1, black_british: 0, mixed: 0, other: 0 },
    age: { young: 22, mid: 26, mature: 29, senior: 23 },
    education: {
      no_qualifications: 33,
      gcse_equivalent: 29,
      a_level_equivalent: 21,
      degree_plus: 17,
    },
    income: { low: 32, middle: 52, high: 16 },
    urbanization: { urban: 48, suburban: 26, rural: 26 },
  },
};
