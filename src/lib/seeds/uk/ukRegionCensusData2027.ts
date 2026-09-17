/**
 * United Kingdom Region Census Profiles, 2027 era.
 *
 * 2027-default companion to {@link ukRegionCensusData2023} (the 2023
 * profiles). All values are independently authored literals for 2027, NOT
 * scaled or derived from any other era's data in code. They continue the
 * 2023 structure with small documented projection drifts.
 *
 * 2027 projection assumptions (2023 bundle as the visible baseline):
 * - Ethnicity: net migration stays high through 2024-26 (ONS long-term
 *   international migration estimates), so `other` rises 1 point in most
 *   regions and London's White British share slips below half. Sources: ONS
 *   Census 2021 and Scotland's Census 2022 as the base, ONS "Long-term
 *   international migration" (https://www.ons.gov.uk/peoplepopulationandcommunity/populationandmigration/internationalmigration).
 * - Age: every region ages about 1 point from `young`/`mid` into `senior`,
 *   fastest in the coastal retirement belt (South West, Wales, East of
 *   England). Source: ONS 2021-based interim national population
 *   projections (https://www.ons.gov.uk/peoplepopulationandcommunity/populationandmigration/populationprojections).
 * - Education: graduate expansion continues, so `degree_plus` rises 2
 *   points funded from `no_qualifications` and `gcse_equivalent`. Source:
 *   ONS Annual Population Survey qualification tables.
 * - Income: era-neutral relative tiers (no GBP thresholds). Real pay
 *   recovery after the 2022-23 squeeze moves about 1 point from `low` to
 *   `high`. Source: ONS "Regional labour market statistics".
 * - Urbanization: structural and held constant from 2023.
 *
 * NOTE: the shared Layer-1 model registry (`src/lib/seeds/international/`)
 * is outside this change's editable scope, so this bundle is consumed by
 * country-local tests for now. Wiring it into the Layer-1 era map is a
 * follow-up in shared code.
 */

import type { UKRegionLayer1 } from "./ukRegionCensusData";

export const ukRegionCensusData2027: Record<string, UKRegionLayer1> = {
  LON: {
    ethnicity: { white_british: 48, asian_british: 22, black_british: 14, mixed: 6, other: 10 },
    age: { young: 21, mid: 31, mature: 27, senior: 21 },
    education: {
      no_qualifications: 6,
      gcse_equivalent: 18,
      a_level_equivalent: 21,
      degree_plus: 55,
    },
    income: { low: 23, middle: 44, high: 33 },
    urbanization: { urban: 98, suburban: 2, rural: 0 },
  },
  SEE: {
    ethnicity: { white_british: 79, asian_british: 9, black_british: 4, mixed: 3, other: 5 },
    age: { young: 16, mid: 26, mature: 30, senior: 28 },
    education: {
      no_qualifications: 8,
      gcse_equivalent: 26,
      a_level_equivalent: 24,
      degree_plus: 42,
    },
    income: { low: 16, middle: 49, high: 35 },
    urbanization: { urban: 61, suburban: 27, rural: 12 },
  },
  SWE: {
    // Oldest regional age profile in England; coastal retirement belt.
    ethnicity: { white_british: 92, asian_british: 3, black_british: 1, mixed: 2, other: 2 },
    age: { young: 15, mid: 24, mature: 29, senior: 32 },
    education: {
      no_qualifications: 10,
      gcse_equivalent: 28,
      a_level_equivalent: 25,
      degree_plus: 37,
    },
    income: { low: 20, middle: 53, high: 27 },
    urbanization: { urban: 43, suburban: 26, rural: 31 },
  },
  EAE: {
    ethnicity: { white_british: 80, asian_british: 9, black_british: 4, mixed: 3, other: 4 },
    age: { young: 16, mid: 25, mature: 29, senior: 30 },
    education: {
      no_qualifications: 9,
      gcse_equivalent: 27,
      a_level_equivalent: 24,
      degree_plus: 40,
    },
    income: { low: 18, middle: 52, high: 30 },
    urbanization: { urban: 53, suburban: 30, rural: 17 },
  },
  EMI: {
    ethnicity: { white_british: 81, asian_british: 9, black_british: 4, mixed: 3, other: 3 },
    age: { young: 16, mid: 25, mature: 30, senior: 29 },
    education: {
      no_qualifications: 11,
      gcse_equivalent: 28,
      a_level_equivalent: 25,
      degree_plus: 36,
    },
    income: { low: 22, middle: 53, high: 25 },
    urbanization: { urban: 56, suburban: 27, rural: 17 },
  },
  WMI: {
    // Birmingham majority-minority at Census 2021; drift continues.
    ethnicity: { white_british: 65, asian_british: 19, black_british: 8, mixed: 4, other: 4 },
    age: { young: 18, mid: 26, mature: 28, senior: 28 },
    education: {
      no_qualifications: 12,
      gcse_equivalent: 28,
      a_level_equivalent: 24,
      degree_plus: 36,
    },
    income: { low: 25, middle: 50, high: 25 },
    urbanization: { urban: 76, suburban: 17, rural: 7 },
  },
  YHU: {
    ethnicity: { white_british: 80, asian_british: 10, black_british: 4, mixed: 3, other: 3 },
    age: { young: 17, mid: 25, mature: 29, senior: 29 },
    education: {
      no_qualifications: 12,
      gcse_equivalent: 29,
      a_level_equivalent: 24,
      degree_plus: 35,
    },
    income: { low: 24, middle: 52, high: 24 },
    urbanization: { urban: 63, suburban: 23, rural: 14 },
  },
  NWE: {
    ethnicity: { white_british: 77, asian_british: 11, black_british: 4, mixed: 3, other: 5 },
    age: { young: 18, mid: 26, mature: 29, senior: 27 },
    education: {
      no_qualifications: 11,
      gcse_equivalent: 28,
      a_level_equivalent: 25,
      degree_plus: 36,
    },
    income: { low: 25, middle: 51, high: 24 },
    urbanization: { urban: 77, suburban: 15, rural: 8 },
  },
  NEE: {
    ethnicity: { white_british: 91, asian_british: 4, black_british: 1, mixed: 2, other: 2 },
    age: { young: 16, mid: 24, mature: 30, senior: 30 },
    education: {
      no_qualifications: 14,
      gcse_equivalent: 30,
      a_level_equivalent: 24,
      degree_plus: 32,
    },
    income: { low: 31, middle: 52, high: 17 },
    urbanization: { urban: 59, suburban: 24, rural: 17 },
  },
  SCO: {
    ethnicity: { white_british: 90, asian_british: 5, black_british: 1, mixed: 1, other: 3 },
    age: { young: 16, mid: 25, mature: 29, senior: 30 },
    education: {
      no_qualifications: 7,
      gcse_equivalent: 22,
      a_level_equivalent: 28,
      degree_plus: 43,
    },
    income: { low: 22, middle: 51, high: 27 },
    urbanization: { urban: 69, suburban: 17, rural: 14 },
  },
  WAL: {
    ethnicity: { white_british: 91, asian_british: 4, black_british: 1, mixed: 2, other: 2 },
    age: { young: 15, mid: 23, mature: 29, senior: 33 },
    education: {
      no_qualifications: 12,
      gcse_equivalent: 28,
      a_level_equivalent: 25,
      degree_plus: 35,
    },
    income: { low: 28, middle: 52, high: 20 },
    urbanization: { urban: 45, suburban: 27, rural: 28 },
  },
  NIR: {
    ethnicity: { white_british: 94, asian_british: 2, black_british: 1, mixed: 1, other: 2 },
    age: { young: 17, mid: 26, mature: 29, senior: 28 },
    education: {
      no_qualifications: 10,
      gcse_equivalent: 26,
      a_level_equivalent: 26,
      degree_plus: 38,
    },
    income: { low: 26, middle: 52, high: 22 },
    urbanization: { urban: 47, suburban: 28, rural: 25 },
  },
};
