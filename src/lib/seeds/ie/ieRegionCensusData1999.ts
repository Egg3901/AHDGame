/**
 * Ireland Region Census Profiles — 1999 (early Celtic Tiger) era.
 *
 * Era anchor: CSO Census of Population 2002 (interpolated back to 1999 with
 * 1996 census detail). Every value is independently authored from historical
 * knowledge of each region in 1999 — NOT scaled or derived from any other era
 * file.
 *
 * 1999 Ireland: FDI boom concentrated in Dublin and Cork (pharma/tech),
 * unemployment collapsing, net migration just turned positive as emigrants of
 * the 1980s returned; inward migration still small (returning Irish, some UK,
 * first asylum cohorts). Free-fees third level (1996) and the 1967 secondary
 * expansion now visible in the adult stock. Income tiers are era-neutral
 * relative tiers.
 */

import type { IERegionLayer1 } from "./ieRegionCensusData";

export const ieRegionCensusData1999: Record<string, IERegionLayer1> = {
  // Dublin — epicentre of the boom; IFSC, first tech wave.
  DUB: {
    ethnicity: { irish: 93, uk_british: 3, eu_other: 2, rest_of_world: 2 },
    age: { young: 26, mid: 27, mature: 28, senior: 19 },
    education: { primary_or_less: 22, leaving_cert: 34, post_secondary: 22, third_level: 22 },
    income: { low: 26, middle: 52, high: 22 },
    urbanization: { urban: 90, suburban: 8, rural: 2 },
  },
  // Kildare / commuter belt — first big estate-building wave for Dublin workers.
  KIL: {
    ethnicity: { irish: 95, uk_british: 3, eu_other: 1, rest_of_world: 1 },
    age: { young: 26, mid: 27, mature: 28, senior: 19 },
    education: { primary_or_less: 26, leaving_cert: 36, post_secondary: 20, third_level: 18 },
    income: { low: 26, middle: 54, high: 20 },
    urbanization: { urban: 38, suburban: 36, rural: 26 },
  },
  // Midlands — boom slowest to arrive; still farm- and peat-dependent.
  MID: {
    ethnicity: { irish: 97, uk_british: 1, eu_other: 1, rest_of_world: 1 },
    age: { young: 26, mid: 24, mature: 28, senior: 22 },
    education: { primary_or_less: 32, leaving_cert: 36, post_secondary: 18, third_level: 14 },
    income: { low: 34, middle: 52, high: 14 },
    urbanization: { urban: 25, suburban: 30, rural: 45 },
  },
  // Wexford / South-East — modest industrial growth, Rosslare trade.
  WEX: {
    ethnicity: { irish: 96, uk_british: 2, eu_other: 1, rest_of_world: 1 },
    age: { young: 26, mid: 24, mature: 28, senior: 22 },
    education: { primary_or_less: 31, leaving_cert: 36, post_secondary: 18, third_level: 15 },
    income: { low: 32, middle: 52, high: 16 },
    urbanization: { urban: 32, suburban: 30, rural: 38 },
  },
  // Limerick / Mid-West — Dell/Analog Devices anchoring a tech cluster.
  LIM: {
    ethnicity: { irish: 95, uk_british: 2, eu_other: 1, rest_of_world: 2 },
    age: { young: 26, mid: 25, mature: 28, senior: 21 },
    education: { primary_or_less: 29, leaving_cert: 36, post_secondary: 19, third_level: 16 },
    income: { low: 30, middle: 52, high: 18 },
    urbanization: { urban: 47, suburban: 26, rural: 27 },
  },
  // Cork / South-West — pharma corridor (Ringaskiddy) in full swing.
  COR: {
    ethnicity: { irish: 95, uk_british: 2, eu_other: 1, rest_of_world: 2 },
    age: { young: 26, mid: 26, mature: 28, senior: 20 },
    education: { primary_or_less: 27, leaving_cert: 35, post_secondary: 20, third_level: 18 },
    income: { low: 28, middle: 52, high: 20 },
    urbanization: { urban: 52, suburban: 25, rural: 23 },
  },
  // Galway / West — medtech cluster forming; university city growing fast.
  GAL: {
    ethnicity: { irish: 95, uk_british: 2, eu_other: 1, rest_of_world: 2 },
    age: { young: 27, mid: 25, mature: 27, senior: 21 },
    education: { primary_or_less: 29, leaving_cert: 35, post_secondary: 19, third_level: 17 },
    income: { low: 31, middle: 51, high: 18 },
    urbanization: { urban: 37, suburban: 26, rural: 37 },
  },
  // Donegal / Border — bypassed by the boom; textiles declining; peace process new.
  DON: {
    ethnicity: { irish: 95, uk_british: 3, eu_other: 1, rest_of_world: 1 },
    age: { young: 26, mid: 24, mature: 27, senior: 23 },
    education: { primary_or_less: 36, leaving_cert: 35, post_secondary: 17, third_level: 12 },
    income: { low: 39, middle: 49, high: 12 },
    urbanization: { urban: 22, suburban: 26, rural: 52 },
  },
};
