/**
 * Germany Region Census Profiles — 2007 (pre-crash export boom).
 *
 * 2007-era companion to {@link deRegionCensusData} (the 2019 profiles).
 * All values independently authored from 2007 historical knowledge of each
 * Land — never derived by scaling another era's file.
 *
 * Era anchor: first Merkel grand coalition; Hartz-IV reform aftermath (a
 * visible low-income/ALG-II stratum in the West, deep in the East) combined
 * with the strongest export boom since reunification — southern Länder near
 * full employment while NW's Ruhr and the eastern Länder still carried
 * double-digit unemployment. Eastern emigration had passed its peak but the
 * age structure was now visibly aged. The Mikrozensus first measured
 * "Migrationshintergrund" in 2005: western shares had grown via family
 * reunification and EU-2004 eastern enlargement; MENA shares were still
 * pre-2015 modest. Tertiary attainment was climbing (Bologna expansion),
 * Lehre still dominant.
 */

import type { DERegionLayer1 } from "./deRegionCensusData";

export const deRegionCensusData2007: Record<string, DERegionLayer1> = {
  // ── Süden ──────────────────────────────────────────────────────────────────
  BW: {
    ethnicity: {
      german: 81,
      turkish_russian_diaspora: 8,
      mena: 2,
      eu_southern_eastern: 6,
      other: 3,
    },
    age: { young: 16, mid: 24, mature: 35, senior: 25 },
    education: { no_degree: 15, berufsausbildung: 47, abitur: 19, hochschulabschluss: 19 },
    income: { low: 16, middle: 54, high: 30 },
    urbanization: { urban: 42, suburban: 38, rural: 20 },
  },
  BY: {
    ethnicity: {
      german: 84,
      turkish_russian_diaspora: 6,
      mena: 2,
      eu_southern_eastern: 5,
      other: 3,
    },
    age: { young: 16, mid: 24, mature: 35, senior: 25 },
    education: { no_degree: 15, berufsausbildung: 48, abitur: 19, hochschulabschluss: 18 },
    income: { low: 19, middle: 53, high: 28 },
    urbanization: { urban: 44, suburban: 30, rural: 26 },
  },

  // ── Westen ─────────────────────────────────────────────────────────────────
  NW: {
    ethnicity: {
      german: 79,
      turkish_russian_diaspora: 9,
      mena: 4,
      eu_southern_eastern: 5,
      other: 3,
    },
    age: { young: 16, mid: 24, mature: 34, senior: 26 },
    education: { no_degree: 17, berufsausbildung: 47, abitur: 18, hochschulabschluss: 18 },
    income: { low: 23, middle: 53, high: 24 },
    urbanization: { urban: 60, suburban: 28, rural: 12 },
  },
  HE: {
    ethnicity: {
      german: 80,
      turkish_russian_diaspora: 7,
      mena: 4,
      eu_southern_eastern: 5,
      other: 4,
    },
    age: { young: 16, mid: 25, mature: 34, senior: 25 },
    education: { no_degree: 15, berufsausbildung: 44, abitur: 20, hochschulabschluss: 21 },
    income: { low: 20, middle: 51, high: 29 },
    urbanization: { urban: 48, suburban: 32, rural: 20 },
  },
  RP: {
    ethnicity: {
      german: 87,
      turkish_russian_diaspora: 5,
      mena: 2,
      eu_southern_eastern: 4,
      other: 2,
    },
    age: { young: 16, mid: 23, mature: 35, senior: 26 },
    education: { no_degree: 17, berufsausbildung: 50, abitur: 17, hochschulabschluss: 16 },
    income: { low: 21, middle: 56, high: 23 },
    urbanization: { urban: 33, suburban: 35, rural: 32 },
  },
  SL: {
    ethnicity: {
      german: 89,
      turkish_russian_diaspora: 4,
      mena: 1,
      eu_southern_eastern: 4,
      other: 2,
    },
    age: { young: 15, mid: 22, mature: 35, senior: 28 },
    education: { no_degree: 17, berufsausbildung: 53, abitur: 15, hochschulabschluss: 15 },
    income: { low: 24, middle: 56, high: 20 },
    urbanization: { urban: 35, suburban: 40, rural: 25 },
  },

  // ── Norden ─────────────────────────────────────────────────────────────────
  NI: {
    ethnicity: {
      german: 89,
      turkish_russian_diaspora: 5,
      mena: 1,
      eu_southern_eastern: 3,
      other: 2,
    },
    age: { young: 16, mid: 23, mature: 35, senior: 26 },
    education: { no_degree: 17, berufsausbildung: 49, abitur: 17, hochschulabschluss: 17 },
    income: { low: 22, middle: 55, high: 23 },
    urbanization: { urban: 38, suburban: 30, rural: 32 },
  },
  SH: {
    ethnicity: {
      german: 91,
      turkish_russian_diaspora: 4,
      mena: 1,
      eu_southern_eastern: 2,
      other: 2,
    },
    age: { young: 15, mid: 23, mature: 35, senior: 27 },
    education: { no_degree: 16, berufsausbildung: 49, abitur: 18, hochschulabschluss: 17 },
    income: { low: 22, middle: 54, high: 24 },
    urbanization: { urban: 30, suburban: 35, rural: 35 },
  },
  HH: {
    ethnicity: {
      german: 76,
      turkish_russian_diaspora: 8,
      mena: 5,
      eu_southern_eastern: 6,
      other: 5,
    },
    age: { young: 18, mid: 27, mature: 31, senior: 24 },
    education: { no_degree: 15, berufsausbildung: 37, abitur: 21, hochschulabschluss: 27 },
    income: { low: 22, middle: 47, high: 31 },
    urbanization: { urban: 100, suburban: 0, rural: 0 },
  },
  BRE: {
    ethnicity: {
      german: 78,
      turkish_russian_diaspora: 9,
      mena: 5,
      eu_southern_eastern: 4,
      other: 4,
    },
    age: { young: 18, mid: 26, mature: 32, senior: 24 },
    education: { no_degree: 18, berufsausbildung: 42, abitur: 18, hochschulabschluss: 22 },
    income: { low: 27, middle: 51, high: 22 },
    urbanization: { urban: 98, suburban: 2, rural: 0 },
  },

  // ── Osten ──────────────────────────────────────────────────────────────────
  BE: {
    ethnicity: {
      german: 76,
      turkish_russian_diaspora: 11,
      mena: 6,
      eu_southern_eastern: 4,
      other: 3,
    },
    age: { young: 18, mid: 28, mature: 31, senior: 23 },
    education: { no_degree: 14, berufsausbildung: 38, abitur: 22, hochschulabschluss: 26 },
    income: { low: 30, middle: 49, high: 21 },
    urbanization: { urban: 100, suburban: 0, rural: 0 },
  },
  BB: {
    ethnicity: {
      german: 96,
      turkish_russian_diaspora: 2,
      mena: 0,
      eu_southern_eastern: 1,
      other: 1,
    },
    age: { young: 14, mid: 21, mature: 38, senior: 27 },
    education: { no_degree: 12, berufsausbildung: 59, abitur: 14, hochschulabschluss: 15 },
    income: { low: 31, middle: 55, high: 14 },
    urbanization: { urban: 22, suburban: 28, rural: 50 },
  },
  MV: {
    ethnicity: {
      german: 97,
      turkish_russian_diaspora: 1,
      mena: 0,
      eu_southern_eastern: 1,
      other: 1,
    },
    age: { young: 14, mid: 21, mature: 38, senior: 27 },
    education: { no_degree: 12, berufsausbildung: 61, abitur: 13, hochschulabschluss: 14 },
    income: { low: 37, middle: 51, high: 12 },
    urbanization: { urban: 18, suburban: 22, rural: 60 },
  },
  SN: {
    ethnicity: {
      german: 96,
      turkish_russian_diaspora: 2,
      mena: 0,
      eu_southern_eastern: 1,
      other: 1,
    },
    age: { young: 14, mid: 21, mature: 38, senior: 27 },
    education: { no_degree: 11, berufsausbildung: 58, abitur: 15, hochschulabschluss: 16 },
    income: { low: 32, middle: 54, high: 14 },
    urbanization: { urban: 38, suburban: 30, rural: 32 },
  },
  ST: {
    ethnicity: {
      german: 97,
      turkish_russian_diaspora: 1,
      mena: 0,
      eu_southern_eastern: 1,
      other: 1,
    },
    age: { young: 13, mid: 20, mature: 39, senior: 28 },
    education: { no_degree: 13, berufsausbildung: 61, abitur: 13, hochschulabschluss: 13 },
    income: { low: 35, middle: 53, high: 12 },
    urbanization: { urban: 30, suburban: 28, rural: 42 },
  },
  TH: {
    ethnicity: {
      german: 97,
      turkish_russian_diaspora: 1,
      mena: 0,
      eu_southern_eastern: 1,
      other: 1,
    },
    age: { young: 13, mid: 21, mature: 39, senior: 27 },
    education: { no_degree: 12, berufsausbildung: 60, abitur: 14, hochschulabschluss: 14 },
    income: { low: 33, middle: 54, high: 13 },
    urbanization: { urban: 25, suburban: 28, rural: 47 },
  },
};
