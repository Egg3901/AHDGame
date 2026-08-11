/**
 * Ireland Region Census Profiles — Layer 1 demographic breakdown per planning
 * region. Mirrors the structure of the UK/JP/DE census files.
 *
 * This module owns the {@link IERegionLayer1} shape. The `2019-default`
 * profiles below are authored in a later task; the `1991-default` companion
 * lives in `ieRegionCensusData1991.ts`. The preset registry
 * (`getRegionCensusData`) selects between them at render time.
 *
 * Fields (% of adult population):
 *   ethnicity    — CSO usual-residence ethnicity / place of birth groupings
 *   age          — Adult (18+) distribution
 *   education    — Highest level of education completed
 *   income       — Relative household-income tiers (era-neutral)
 *   urbanization — City / town / rural split
 */

export interface IERegionLayer1 {
  ethnicity: {
    irish: number;
    uk_british: number;
    eu_other: number;
    rest_of_world: number;
  };
  age: { young: number; mid: number; mature: number; senior: number };
  education: {
    primary_or_less: number;
    leaving_cert: number;
    post_secondary: number;
    third_level: number;
  };
  income: { low: number; middle: number; high: number };
  urbanization: { urban: number; suburban: number; rural: number };
}

/**
 * 2019-default (modern) profiles — approximate CSO Census 2022 estimates
 * (% of adult population). Keys stay in sync with {@link ieRegionCensusData1991}
 * and `REGION_CENSUS_LABELS.IE`.
 *
 * Directional vs the 1991 profiles: lower `irish` share (post-accession EU +
 * global migration), markedly higher `third_level`, higher urbanization.
 */
export const ieRegionCensusData: Record<string, IERegionLayer1> = {
  // Dublin — most diverse, most urban, highest third-level.
  DUB: {
    ethnicity: { irish: 78, uk_british: 4, eu_other: 10, rest_of_world: 8 },
    age: { young: 24, mid: 28, mature: 28, senior: 20 },
    education: { primary_or_less: 10, leaving_cert: 26, post_secondary: 18, third_level: 46 },
    income: { low: 22, middle: 48, high: 30 },
    urbanization: { urban: 92, suburban: 7, rural: 1 },
  },
  KIL: {
    ethnicity: { irish: 84, uk_british: 4, eu_other: 8, rest_of_world: 4 },
    age: { young: 23, mid: 28, mature: 29, senior: 20 },
    education: { primary_or_less: 12, leaving_cert: 30, post_secondary: 20, third_level: 38 },
    income: { low: 20, middle: 52, high: 28 },
    urbanization: { urban: 45, suburban: 38, rural: 17 },
  },
  MID: {
    ethnicity: { irish: 86, uk_british: 3, eu_other: 8, rest_of_world: 3 },
    age: { young: 24, mid: 26, mature: 28, senior: 22 },
    education: { primary_or_less: 16, leaving_cert: 34, post_secondary: 22, third_level: 28 },
    income: { low: 30, middle: 52, high: 18 },
    urbanization: { urban: 30, suburban: 32, rural: 38 },
  },
  WEX: {
    ethnicity: { irish: 87, uk_british: 4, eu_other: 6, rest_of_world: 3 },
    age: { young: 23, mid: 26, mature: 29, senior: 22 },
    education: { primary_or_less: 15, leaving_cert: 33, post_secondary: 22, third_level: 30 },
    income: { low: 28, middle: 52, high: 20 },
    urbanization: { urban: 35, suburban: 32, rural: 33 },
  },
  LIM: {
    ethnicity: { irish: 85, uk_british: 3, eu_other: 8, rest_of_world: 4 },
    age: { young: 24, mid: 27, mature: 28, senior: 21 },
    education: { primary_or_less: 13, leaving_cert: 31, post_secondary: 21, third_level: 35 },
    income: { low: 26, middle: 52, high: 22 },
    urbanization: { urban: 50, suburban: 27, rural: 23 },
  },
  COR: {
    ethnicity: { irish: 84, uk_british: 3, eu_other: 8, rest_of_world: 5 },
    age: { young: 24, mid: 28, mature: 28, senior: 20 },
    education: { primary_or_less: 11, leaving_cert: 29, post_secondary: 20, third_level: 40 },
    income: { low: 24, middle: 50, high: 26 },
    urbanization: { urban: 55, suburban: 25, rural: 20 },
  },
  GAL: {
    ethnicity: { irish: 84, uk_british: 3, eu_other: 8, rest_of_world: 5 },
    age: { young: 25, mid: 27, mature: 27, senior: 21 },
    education: { primary_or_less: 12, leaving_cert: 30, post_secondary: 20, third_level: 38 },
    income: { low: 27, middle: 50, high: 23 },
    urbanization: { urban: 40, suburban: 27, rural: 33 },
  },
  DON: {
    ethnicity: { irish: 88, uk_british: 5, eu_other: 4, rest_of_world: 3 },
    age: { young: 24, mid: 25, mature: 28, senior: 23 },
    education: { primary_or_less: 18, leaving_cert: 34, post_secondary: 22, third_level: 26 },
    income: { low: 34, middle: 50, high: 16 },
    urbanization: { urban: 25, suburban: 28, rural: 47 },
  },
};
