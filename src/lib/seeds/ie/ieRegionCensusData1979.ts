/**
 * Ireland Region Census Profiles — 1979 (pre-Tiger) era.
 *
 * Era anchor: CSO Census of Population 1979 (with 1981 detail tables for
 * education/age structure). Every value is independently authored from
 * historical knowledge of each region in 1979 — NOT scaled or derived from any
 * other era file.
 *
 * 1979 Ireland: poor by Western European standards, very young (one of the
 * highest birth rates in Europe), persistent emigration, near-zero inward
 * migration, overwhelmingly Catholic and Irish-born, agrarian outside Dublin.
 * Free secondary education (1967) had not yet fed through the adult stock, so
 * primary-or-less dominates education everywhere; third level is a small
 * elite. Income tiers are era-neutral relative tiers.
 */

import type { IERegionLayer1 } from "./ieRegionCensusData";

export const ieRegionCensusData1979: Record<string, IERegionLayer1> = {
  // Dublin — only major urban centre; modest professional class.
  DUB: {
    ethnicity: { irish: 98, uk_british: 1, eu_other: 1, rest_of_world: 0 },
    age: { young: 30, mid: 26, mature: 26, senior: 18 },
    education: { primary_or_less: 48, leaving_cert: 32, post_secondary: 12, third_level: 8 },
    income: { low: 32, middle: 52, high: 16 },
    urbanization: { urban: 85, suburban: 12, rural: 3 },
  },
  // Kildare / commuter belt — still largely farmland with garrison towns.
  KIL: {
    ethnicity: { irish: 98, uk_british: 1, eu_other: 1, rest_of_world: 0 },
    age: { young: 29, mid: 25, mature: 27, senior: 19 },
    education: { primary_or_less: 52, leaving_cert: 30, post_secondary: 12, third_level: 6 },
    income: { low: 34, middle: 52, high: 14 },
    urbanization: { urban: 28, suburban: 32, rural: 40 },
  },
  // Midlands — small farms, bogs (Bord na Móna), heavy emigration.
  MID: {
    ethnicity: { irish: 99, uk_british: 1, eu_other: 0, rest_of_world: 0 },
    age: { young: 30, mid: 23, mature: 26, senior: 21 },
    education: { primary_or_less: 58, leaving_cert: 28, post_secondary: 10, third_level: 4 },
    income: { low: 44, middle: 46, high: 10 },
    urbanization: { urban: 18, suburban: 26, rural: 56 },
  },
  // Wexford / South-East — tillage farming, small port towns.
  WEX: {
    ethnicity: { irish: 99, uk_british: 1, eu_other: 0, rest_of_world: 0 },
    age: { young: 29, mid: 24, mature: 26, senior: 21 },
    education: { primary_or_less: 56, leaving_cert: 29, post_secondary: 10, third_level: 5 },
    income: { low: 42, middle: 48, high: 10 },
    urbanization: { urban: 25, suburban: 27, rural: 48 },
  },
  // Limerick / Mid-West — Shannon industrial zone the lone bright spot.
  LIM: {
    ethnicity: { irish: 98, uk_british: 1, eu_other: 1, rest_of_world: 0 },
    age: { young: 30, mid: 24, mature: 26, senior: 20 },
    education: { primary_or_less: 53, leaving_cert: 30, post_secondary: 11, third_level: 6 },
    income: { low: 40, middle: 48, high: 12 },
    urbanization: { urban: 40, suburban: 24, rural: 36 },
  },
  // Cork / South-West — second city; Ford/Dunlop plants still operating.
  COR: {
    ethnicity: { irish: 98, uk_british: 1, eu_other: 1, rest_of_world: 0 },
    age: { young: 30, mid: 25, mature: 26, senior: 19 },
    education: { primary_or_less: 50, leaving_cert: 31, post_secondary: 12, third_level: 7 },
    income: { low: 36, middle: 50, high: 14 },
    urbanization: { urban: 45, suburban: 24, rural: 31 },
  },
  // Galway / West — smallholdings, Gaeltacht, chronic emigration.
  GAL: {
    ethnicity: { irish: 98, uk_british: 1, eu_other: 0, rest_of_world: 1 },
    age: { young: 31, mid: 23, mature: 25, senior: 21 },
    education: { primary_or_less: 55, leaving_cert: 28, post_secondary: 11, third_level: 6 },
    income: { low: 42, middle: 47, high: 11 },
    urbanization: { urban: 28, suburban: 24, rural: 48 },
  },
  // Donegal / Border — poorest, most rural; Troubles disrupting trade.
  DON: {
    ethnicity: { irish: 98, uk_british: 1, eu_other: 1, rest_of_world: 0 },
    age: { young: 31, mid: 22, mature: 24, senior: 23 },
    education: { primary_or_less: 62, leaving_cert: 26, post_secondary: 8, third_level: 4 },
    income: { low: 50, middle: 42, high: 8 },
    urbanization: { urban: 14, suburban: 22, rural: 64 },
  },
};
