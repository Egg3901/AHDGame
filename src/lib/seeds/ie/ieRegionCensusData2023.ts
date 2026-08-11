/**
 * Ireland Region Census Profiles — 2023 (post-pandemic) era.
 *
 * Era anchor: CSO Census of Population 2022 (with 2023 population estimates).
 * Every value is independently authored from historical knowledge of each
 * region in 2023 — NOT scaled or derived from any other era file.
 *
 * 2023 Ireland: roughly 20% foreign-born (CSO 2022: ~20% of usual residents
 * born abroad), with Dublin and the cities most diverse and even rural
 * counties reshaped by EU workers, Ukrainian arrivals, and asylum
 * accommodation. Graduate share among the EU's highest (50%+ third-level in
 * Dublin's adult population), severe housing crisis pushing commuters ever
 * further out, and a visibly ageing population versus the boom years. Income
 * tiers are era-neutral relative tiers.
 */

import type { IERegionLayer1 } from "./ieRegionCensusData";

export const ieRegionCensusData2023: Record<string, IERegionLayer1> = {
  // Dublin — tech/finance capital; majority-graduate adult population.
  DUB: {
    ethnicity: { irish: 73, uk_british: 3, eu_other: 11, rest_of_world: 13 },
    age: { young: 23, mid: 29, mature: 28, senior: 20 },
    education: { primary_or_less: 8, leaving_cert: 24, post_secondary: 18, third_level: 50 },
    income: { low: 22, middle: 46, high: 32 },
    urbanization: { urban: 93, suburban: 6, rural: 1 },
  },
  // Kildare / commuter belt — housing-crisis overspill; young families.
  KIL: {
    ethnicity: { irish: 81, uk_british: 3, eu_other: 9, rest_of_world: 7 },
    age: { young: 22, mid: 28, mature: 30, senior: 20 },
    education: { primary_or_less: 10, leaving_cert: 28, post_secondary: 20, third_level: 42 },
    income: { low: 20, middle: 50, high: 30 },
    urbanization: { urban: 47, suburban: 38, rural: 15 },
  },
  // Midlands — remote-work spillover; data centres; just-transition from peat.
  MID: {
    ethnicity: { irish: 83, uk_british: 3, eu_other: 9, rest_of_world: 5 },
    age: { young: 23, mid: 26, mature: 28, senior: 23 },
    education: { primary_or_less: 14, leaving_cert: 32, post_secondary: 22, third_level: 32 },
    income: { low: 28, middle: 52, high: 20 },
    urbanization: { urban: 32, suburban: 33, rural: 35 },
  },
  // Wexford / South-East — retiree and remote-worker inflow on the coast.
  WEX: {
    ethnicity: { irish: 84, uk_british: 4, eu_other: 7, rest_of_world: 5 },
    age: { young: 22, mid: 26, mature: 29, senior: 23 },
    education: { primary_or_less: 13, leaving_cert: 31, post_secondary: 22, third_level: 34 },
    income: { low: 27, middle: 52, high: 21 },
    urbanization: { urban: 36, suburban: 33, rural: 31 },
  },
  // Limerick / Mid-West — post-Dell rebound; aerospace and pharma growth.
  LIM: {
    ethnicity: { irish: 81, uk_british: 3, eu_other: 9, rest_of_world: 7 },
    age: { young: 23, mid: 27, mature: 28, senior: 22 },
    education: { primary_or_less: 11, leaving_cert: 29, post_secondary: 21, third_level: 39 },
    income: { low: 25, middle: 51, high: 24 },
    urbanization: { urban: 52, suburban: 27, rural: 21 },
  },
  // Cork / South-West — Apple/pharma hub; second-most-diverse region.
  COR: {
    ethnicity: { irish: 80, uk_british: 3, eu_other: 9, rest_of_world: 8 },
    age: { young: 23, mid: 28, mature: 28, senior: 21 },
    education: { primary_or_less: 9, leaving_cert: 27, post_secondary: 20, third_level: 44 },
    income: { low: 23, middle: 49, high: 28 },
    urbanization: { urban: 57, suburban: 25, rural: 18 },
  },
  // Galway / West — medtech capital; university city with large student share.
  GAL: {
    ethnicity: { irish: 80, uk_british: 3, eu_other: 9, rest_of_world: 8 },
    age: { young: 24, mid: 27, mature: 27, senior: 22 },
    education: { primary_or_less: 10, leaving_cert: 28, post_secondary: 20, third_level: 42 },
    income: { low: 26, middle: 49, high: 25 },
    urbanization: { urban: 42, suburban: 27, rural: 31 },
  },
  // Donegal / Border — oldest, most rural; Ukrainian accommodation notable.
  DON: {
    ethnicity: { irish: 85, uk_british: 5, eu_other: 6, rest_of_world: 4 },
    age: { young: 23, mid: 25, mature: 28, senior: 24 },
    education: { primary_or_less: 16, leaving_cert: 32, post_secondary: 22, third_level: 30 },
    income: { low: 32, middle: 50, high: 18 },
    urbanization: { urban: 27, suburban: 29, rural: 44 },
  },
};
