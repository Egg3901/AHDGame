/**
 * Ireland Region Census Profiles — 1991 (pre-Celtic-Tiger) era.
 *
 * 1991-default companion to {@link ieRegionCensusData} (the 2019 profiles).
 * Selected at render time via the preset registry under the `1991-default`
 * reset preset.
 *
 * Sources / methodology (approximate, % of adult population): CSO Census of
 * Population 1991. Pre-1995 Ireland was near-ethnically-homogeneous with
 * minimal inward migration, markedly lower third-level attainment, and a far
 * larger rural share than the 2019 profiles. Income uses era-neutral relative
 * tiers (no punt thresholds).
 *
 * Directional vs the 2019 profiles: higher `irish` share, lower `third_level`,
 * higher rural share — strongest in the Border (DON) and Western (GAL/MID)
 * regions.
 */

import type { IERegionLayer1 } from "./ieRegionCensusData";

export const ieRegionCensusData1991: Record<string, IERegionLayer1> = {
  // ── Leinster ─────────────────────────────────────────────────────────────
  // Dublin — capital, most urban, highest third-level of any 1991 region.
  DUB: {
    ethnicity: { irish: 96, uk_british: 2, eu_other: 1, rest_of_world: 1 },
    age: { young: 26, mid: 24, mature: 30, senior: 20 },
    education: { primary_or_less: 30, leaving_cert: 36, post_secondary: 20, third_level: 14 },
    income: { low: 30, middle: 52, high: 18 },
    urbanization: { urban: 88, suburban: 10, rural: 2 },
  },
  // Kildare / commuter belt (Kildare, Meath, Wicklow).
  KIL: {
    ethnicity: { irish: 97, uk_british: 2, eu_other: 1, rest_of_world: 0 },
    age: { young: 25, mid: 24, mature: 30, senior: 21 },
    education: { primary_or_less: 34, leaving_cert: 36, post_secondary: 18, third_level: 12 },
    income: { low: 30, middle: 53, high: 17 },
    urbanization: { urban: 35, suburban: 35, rural: 30 },
  },
  // Midlands (Laois, Offaly, Longford, Westmeath) — rural, agricultural.
  MID: {
    ethnicity: { irish: 98, uk_british: 1, eu_other: 1, rest_of_world: 0 },
    age: { young: 26, mid: 23, mature: 29, senior: 22 },
    education: { primary_or_less: 40, leaving_cert: 35, post_secondary: 16, third_level: 9 },
    income: { low: 38, middle: 50, high: 12 },
    urbanization: { urban: 22, suburban: 30, rural: 48 },
  },
  // Wexford / South-East.
  WEX: {
    ethnicity: { irish: 97, uk_british: 2, eu_other: 1, rest_of_world: 0 },
    age: { young: 26, mid: 23, mature: 29, senior: 22 },
    education: { primary_or_less: 38, leaving_cert: 36, post_secondary: 16, third_level: 10 },
    income: { low: 36, middle: 50, high: 14 },
    urbanization: { urban: 30, suburban: 30, rural: 40 },
  },

  // ── Munster ──────────────────────────────────────────────────────────────
  // Limerick / Mid-West.
  LIM: {
    ethnicity: { irish: 97, uk_british: 2, eu_other: 1, rest_of_world: 0 },
    age: { young: 26, mid: 23, mature: 30, senior: 21 },
    education: { primary_or_less: 36, leaving_cert: 36, post_secondary: 17, third_level: 11 },
    income: { low: 35, middle: 51, high: 14 },
    urbanization: { urban: 45, suburban: 25, rural: 30 },
  },
  // Cork / South-West — second city.
  COR: {
    ethnicity: { irish: 96, uk_british: 2, eu_other: 1, rest_of_world: 1 },
    age: { young: 26, mid: 24, mature: 29, senior: 21 },
    education: { primary_or_less: 34, leaving_cert: 36, post_secondary: 18, third_level: 12 },
    income: { low: 32, middle: 52, high: 16 },
    urbanization: { urban: 50, suburban: 25, rural: 25 },
  },

  // ── Connacht / Ulster (ROI) ──────────────────────────────────────────────
  // Galway / West.
  GAL: {
    ethnicity: { irish: 97, uk_british: 1, eu_other: 1, rest_of_world: 1 },
    age: { young: 27, mid: 23, mature: 28, senior: 22 },
    education: { primary_or_less: 36, leaving_cert: 35, post_secondary: 17, third_level: 12 },
    income: { low: 36, middle: 50, high: 14 },
    urbanization: { urban: 35, suburban: 25, rural: 40 },
  },
  // Donegal / Border — most rural, lowest income/third-level.
  DON: {
    ethnicity: { irish: 97, uk_british: 2, eu_other: 1, rest_of_world: 0 },
    age: { young: 27, mid: 23, mature: 28, senior: 22 },
    education: { primary_or_less: 42, leaving_cert: 34, post_secondary: 15, third_level: 9 },
    income: { low: 42, middle: 48, high: 10 },
    urbanization: { urban: 20, suburban: 25, rural: 55 },
  },
};
