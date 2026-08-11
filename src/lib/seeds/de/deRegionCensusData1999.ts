/**
 * Germany Region Census Profiles — 1999 (red-green era).
 *
 * 1999-era companion to {@link deRegionCensusData} (the 2019 profiles).
 * All values independently authored from 1999 historical knowledge of each
 * Land — never derived by scaling another era's file.
 *
 * Era anchor: first Schröder government; the federal capital moved to Berlin
 * in 1999. The East was a decade into transformation: deindustrialization
 * complete, unemployment near its peak (~18–20%), heavy westward emigration
 * of the young already underway but the age structure not yet fully aged.
 * The 1990s Aussiedler wave (ethnic Germans from the former USSR — counted
 * under `turkish_russian_diaspora`) and the Yugoslav-war refugee inflows had
 * lifted western migrant shares well above 1991 levels; eastern Länder
 * remained overwhelmingly German with small Aussiedler placements via the
 * Wohnortzuweisungsgesetz. Western economy was sluggish ("sick man of
 * Europe") but household income structure was still solidly middle-heavy.
 * Tertiary attainment was rising slowly; Lehre/Berufsausbildung still the
 * dominant qualification everywhere.
 */

import type { DERegionLayer1 } from "./deRegionCensusData";

export const deRegionCensusData1999: Record<string, DERegionLayer1> = {
  // ── Süden ──────────────────────────────────────────────────────────────────
  BW: {
    ethnicity: {
      german: 83,
      turkish_russian_diaspora: 8,
      mena: 2,
      eu_southern_eastern: 5,
      other: 2,
    },
    age: { young: 18, mid: 25, mature: 33, senior: 24 },
    education: { no_degree: 17, berufsausbildung: 50, abitur: 17, hochschulabschluss: 16 },
    income: { low: 17, middle: 54, high: 29 },
    urbanization: { urban: 36, suburban: 40, rural: 24 },
  },
  BY: {
    ethnicity: {
      german: 86,
      turkish_russian_diaspora: 6,
      mena: 2,
      eu_southern_eastern: 4,
      other: 2,
    },
    age: { young: 18, mid: 25, mature: 33, senior: 24 },
    education: { no_degree: 18, berufsausbildung: 51, abitur: 16, hochschulabschluss: 15 },
    income: { low: 18, middle: 54, high: 28 },
    urbanization: { urban: 41, suburban: 30, rural: 29 },
  },

  // ── Westen ─────────────────────────────────────────────────────────────────
  NW: {
    ethnicity: {
      german: 81,
      turkish_russian_diaspora: 9,
      mena: 3,
      eu_southern_eastern: 5,
      other: 2,
    },
    age: { young: 18, mid: 25, mature: 32, senior: 25 },
    education: { no_degree: 20, berufsausbildung: 49, abitur: 16, hochschulabschluss: 15 },
    income: { low: 23, middle: 54, high: 23 },
    urbanization: { urban: 60, suburban: 28, rural: 12 },
  },
  HE: {
    ethnicity: {
      german: 82,
      turkish_russian_diaspora: 7,
      mena: 3,
      eu_southern_eastern: 5,
      other: 3,
    },
    age: { young: 18, mid: 26, mature: 32, senior: 24 },
    education: { no_degree: 17, berufsausbildung: 47, abitur: 18, hochschulabschluss: 18 },
    income: { low: 20, middle: 53, high: 27 },
    urbanization: { urban: 48, suburban: 32, rural: 20 },
  },
  RP: {
    ethnicity: {
      german: 88,
      turkish_russian_diaspora: 5,
      mena: 2,
      eu_southern_eastern: 3,
      other: 2,
    },
    age: { young: 18, mid: 24, mature: 33, senior: 25 },
    education: { no_degree: 19, berufsausbildung: 52, abitur: 15, hochschulabschluss: 14 },
    income: { low: 22, middle: 56, high: 22 },
    urbanization: { urban: 33, suburban: 35, rural: 32 },
  },
  SL: {
    ethnicity: {
      german: 90,
      turkish_russian_diaspora: 4,
      mena: 1,
      eu_southern_eastern: 3,
      other: 2,
    },
    age: { young: 17, mid: 23, mature: 33, senior: 27 },
    education: { no_degree: 19, berufsausbildung: 55, abitur: 13, hochschulabschluss: 13 },
    income: { low: 25, middle: 56, high: 19 },
    urbanization: { urban: 35, suburban: 40, rural: 25 },
  },

  // ── Norden ─────────────────────────────────────────────────────────────────
  NI: {
    ethnicity: {
      german: 89,
      turkish_russian_diaspora: 6,
      mena: 1,
      eu_southern_eastern: 2,
      other: 2,
    },
    age: { young: 18, mid: 24, mature: 33, senior: 25 },
    education: { no_degree: 20, berufsausbildung: 51, abitur: 15, hochschulabschluss: 14 },
    income: { low: 23, middle: 55, high: 22 },
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
    age: { young: 17, mid: 24, mature: 33, senior: 26 },
    education: { no_degree: 18, berufsausbildung: 51, abitur: 16, hochschulabschluss: 15 },
    income: { low: 22, middle: 55, high: 23 },
    urbanization: { urban: 21, suburban: 33, rural: 46 },
  },
  HH: {
    ethnicity: {
      german: 79,
      turkish_russian_diaspora: 7,
      mena: 4,
      eu_southern_eastern: 6,
      other: 4,
    },
    age: { young: 19, mid: 27, mature: 30, senior: 24 },
    education: { no_degree: 17, berufsausbildung: 40, abitur: 20, hochschulabschluss: 23 },
    income: { low: 23, middle: 49, high: 28 },
    urbanization: { urban: 100, suburban: 0, rural: 0 },
  },
  BRE: {
    ethnicity: {
      german: 81,
      turkish_russian_diaspora: 8,
      mena: 4,
      eu_southern_eastern: 4,
      other: 3,
    },
    age: { young: 19, mid: 26, mature: 31, senior: 24 },
    education: { no_degree: 20, berufsausbildung: 45, abitur: 17, hochschulabschluss: 18 },
    income: { low: 33, middle: 47, high: 20 },
    urbanization: { urban: 98, suburban: 2, rural: 0 },
  },

  // ── Osten ──────────────────────────────────────────────────────────────────
  BE: {
    ethnicity: {
      german: 81,
      turkish_russian_diaspora: 10,
      mena: 4,
      eu_southern_eastern: 3,
      other: 2,
    },
    age: { young: 19, mid: 27, mature: 31, senior: 23 },
    education: { no_degree: 17, berufsausbildung: 42, abitur: 20, hochschulabschluss: 21 },
    income: { low: 34, middle: 47, high: 19 },
    urbanization: { urban: 100, suburban: 0, rural: 0 },
  },
  BB: {
    ethnicity: {
      german: 97,
      turkish_russian_diaspora: 1,
      mena: 0,
      eu_southern_eastern: 1,
      other: 1,
    },
    age: { young: 16, mid: 24, mature: 35, senior: 25 },
    education: { no_degree: 13, berufsausbildung: 61, abitur: 13, hochschulabschluss: 13 },
    income: { low: 39, middle: 51, high: 10 },
    urbanization: { urban: 28, suburban: 30, rural: 42 },
  },
  MV: {
    ethnicity: {
      german: 97,
      turkish_russian_diaspora: 1,
      mena: 0,
      eu_southern_eastern: 1,
      other: 1,
    },
    age: { young: 17, mid: 24, mature: 34, senior: 25 },
    education: { no_degree: 13, berufsausbildung: 63, abitur: 12, hochschulabschluss: 12 },
    income: { low: 48, middle: 44, high: 8 },
    urbanization: { urban: 30, suburban: 24, rural: 46 },
  },
  SN: {
    ethnicity: {
      german: 97,
      turkish_russian_diaspora: 1,
      mena: 0,
      eu_southern_eastern: 1,
      other: 1,
    },
    age: { young: 16, mid: 23, mature: 35, senior: 26 },
    education: { no_degree: 11, berufsausbildung: 61, abitur: 14, hochschulabschluss: 14 },
    income: { low: 36, middle: 53, high: 11 },
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
    age: { young: 16, mid: 23, mature: 35, senior: 26 },
    education: { no_degree: 14, berufsausbildung: 62, abitur: 12, hochschulabschluss: 12 },
    income: { low: 39, middle: 51, high: 10 },
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
    age: { young: 16, mid: 23, mature: 35, senior: 26 },
    education: { no_degree: 12, berufsausbildung: 62, abitur: 13, hochschulabschluss: 13 },
    income: { low: 41, middle: 49, high: 10 },
    urbanization: { urban: 31, suburban: 28, rural: 41 },
  },
};
