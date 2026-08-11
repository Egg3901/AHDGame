/**
 * Ireland Region Census Profiles — 1953 era.
 *
 * 1953-default companion to {@link ieRegionCensusData} (the 2019 profiles).
 * Anchored on CSO Census of Population 1951 (the nearest comprehensive Irish
 * census).
 *
 * Era anchors (de Valera third term / post-war austerity): Ireland was one of
 * the poorest countries in Western Europe; population was still declining from
 * the Famine-era emigration wave — total population around 2.96 million, the
 * lowest since the 1840s; net emigration running at ~40,000 per year draining
 * young people; agriculture employed 40% of the workforce; free secondary
 * education did not exist until 1967 so nearly all adults of 1953 had only
 * primary schooling; third-level was a tiny elite; the country was overwhelm-
 * ingly Catholic (99%), ethnically homogeneous, and virtually without inward
 * migration. Income was very low; rural areas lived close to subsistence.
 * Age distribution: heavy emigration of 20-35-year-olds made the rural
 * regions skew older; Dublin was younger due to internal migration.
 */

import type { IERegionLayer1 } from "./ieRegionCensusData";

export const ieRegionCensusData1953: Record<string, IERegionLayer1> = {
  // Dublin — only real urban centre; government, retail, some light industry.
  DUB: {
    ethnicity: { irish: 99, uk_british: 1, eu_other: 0, rest_of_world: 0 },
    age: { young: 28, mid: 25, mature: 27, senior: 20 },
    education: { primary_or_less: 60, leaving_cert: 27, post_secondary: 9, third_level: 4 },
    income: { low: 40, middle: 50, high: 10 },
    urbanization: { urban: 80, suburban: 13, rural: 7 },
  },
  // Kildare — largely farmland and garrison towns; commuter belt not yet existing.
  KIL: {
    ethnicity: { irish: 99, uk_british: 1, eu_other: 0, rest_of_world: 0 },
    age: { young: 26, mid: 23, mature: 28, senior: 23 },
    education: { primary_or_less: 68, leaving_cert: 24, post_secondary: 6, third_level: 2 },
    income: { low: 46, middle: 47, high: 7 },
    urbanization: { urban: 18, suburban: 28, rural: 54 },
  },
  // Midlands — small farms, bogland; heaviest emigration drain of young.
  MID: {
    ethnicity: { irish: 100, uk_british: 0, eu_other: 0, rest_of_world: 0 },
    age: { young: 24, mid: 21, mature: 28, senior: 27 },
    education: { primary_or_less: 74, leaving_cert: 20, post_secondary: 5, third_level: 1 },
    income: { low: 58, middle: 37, high: 5 },
    urbanization: { urban: 10, suburban: 22, rural: 68 },
  },
  // Wexford / South-East — tillage and livestock; small market towns.
  WEX: {
    ethnicity: { irish: 100, uk_british: 0, eu_other: 0, rest_of_world: 0 },
    age: { young: 25, mid: 22, mature: 27, senior: 26 },
    education: { primary_or_less: 70, leaving_cert: 23, post_secondary: 6, third_level: 1 },
    income: { low: 55, middle: 40, high: 5 },
    urbanization: { urban: 16, suburban: 23, rural: 61 },
  },
  // Limerick / Mid-West — Shannon undeveloped (airport opened 1945, industrial zone later).
  LIM: {
    ethnicity: { irish: 99, uk_british: 1, eu_other: 0, rest_of_world: 0 },
    age: { young: 26, mid: 23, mature: 27, senior: 24 },
    education: { primary_or_less: 66, leaving_cert: 25, post_secondary: 7, third_level: 2 },
    income: { low: 52, middle: 42, high: 6 },
    urbanization: { urban: 28, suburban: 23, rural: 49 },
  },
  // Cork / South-West — second city; Ford and Dunlop still operating.
  COR: {
    ethnicity: { irish: 99, uk_british: 1, eu_other: 0, rest_of_world: 0 },
    age: { young: 26, mid: 23, mature: 27, senior: 24 },
    education: { primary_or_less: 62, leaving_cert: 27, post_secondary: 8, third_level: 3 },
    income: { low: 48, middle: 44, high: 8 },
    urbanization: { urban: 32, suburban: 22, rural: 46 },
  },
  // Galway / West — Gaeltacht; smallholdings; very high emigration drain.
  GAL: {
    ethnicity: { irish: 99, uk_british: 1, eu_other: 0, rest_of_world: 0 },
    age: { young: 26, mid: 20, mature: 26, senior: 28 },
    education: { primary_or_less: 70, leaving_cert: 23, post_secondary: 6, third_level: 1 },
    income: { low: 56, middle: 38, high: 6 },
    urbanization: { urban: 15, suburban: 22, rural: 63 },
  },
  // Donegal / Border — remotest; poorest; highest emigration rate.
  DON: {
    ethnicity: { irish: 99, uk_british: 1, eu_other: 0, rest_of_world: 0 },
    age: { young: 25, mid: 19, mature: 25, senior: 31 },
    education: { primary_or_less: 76, leaving_cert: 18, post_secondary: 5, third_level: 1 },
    income: { low: 64, middle: 31, high: 5 },
    urbanization: { urban: 6, suburban: 18, rural: 76 },
  },
};
