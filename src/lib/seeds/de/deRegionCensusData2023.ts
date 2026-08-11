/**
 * Germany Region Census Profiles — 2023 (post-pandemic, Ampel era).
 *
 * 2023-era companion to {@link deRegionCensusData} (the 2019 profiles).
 * All values independently authored from 2023 historical knowledge of each
 * Land (Zensus 2022, Mikrozensus 2022/23) — never derived by scaling
 * another era's file.
 *
 * Era anchor: Scholz Ampel coalition; post-2015 refugee cohorts integrated
 * into the resident adult population plus the 2022 Ukrainian displacement
 * wave (counted under `turkish_russian_diaspora` alongside Russian-German
 * Aussiedler) push migration-background shares in western metros past 30%
 * of adults — Hamburg, Bremen, Berlin, the Rhine-Ruhr and Rhein-Main belts
 * are now structurally diverse. Eastern Länder remain far more homogeneous
 * but are no longer near-mono-ethnic, and are the oldest regions in the EU
 * (senior shares 30%+). Tertiary attainment continues climbing in the
 * city-states and the South; vocational Lehre still dominant in the East.
 * Inflation-squeezed low band ticks up slightly versus 2019.
 */

import type { DERegionLayer1 } from "./deRegionCensusData";

export const deRegionCensusData2023: Record<string, DERegionLayer1> = {
  // ── Süden ──────────────────────────────────────────────────────────────────
  BW: {
    ethnicity: {
      german: 80,
      turkish_russian_diaspora: 8,
      mena: 4,
      eu_southern_eastern: 4,
      other: 4,
    },
    age: { young: 15, mid: 22, mature: 37, senior: 26 },
    education: { no_degree: 12, berufsausbildung: 40, abitur: 21, hochschulabschluss: 27 },
    income: { low: 19, middle: 51, high: 30 },
    urbanization: { urban: 51, suburban: 34, rural: 15 },
  },
  BY: {
    ethnicity: {
      german: 82,
      turkish_russian_diaspora: 7,
      mena: 4,
      eu_southern_eastern: 4,
      other: 3,
    },
    age: { young: 13, mid: 21, mature: 37, senior: 29 },
    education: { no_degree: 13, berufsausbildung: 40, abitur: 20, hochschulabschluss: 27 },
    income: { low: 18, middle: 51, high: 31 },
    urbanization: { urban: 44, suburban: 32, rural: 24 },
  },

  // ── Westen ─────────────────────────────────────────────────────────────────
  NW: {
    ethnicity: {
      german: 76,
      turkish_russian_diaspora: 9,
      mena: 6,
      eu_southern_eastern: 5,
      other: 4,
    },
    age: { young: 15, mid: 22, mature: 36, senior: 27 },
    education: { no_degree: 14, berufsausbildung: 40, abitur: 20, hochschulabschluss: 26 },
    income: { low: 23, middle: 51, high: 26 },
    urbanization: { urban: 60, suburban: 28, rural: 12 },
  },
  HE: {
    ethnicity: {
      german: 78,
      turkish_russian_diaspora: 7,
      mena: 5,
      eu_southern_eastern: 5,
      other: 5,
    },
    age: { young: 15, mid: 23, mature: 36, senior: 26 },
    education: { no_degree: 12, berufsausbildung: 36, abitur: 22, hochschulabschluss: 30 },
    income: { low: 20, middle: 49, high: 31 },
    urbanization: { urban: 49, suburban: 32, rural: 19 },
  },
  RP: {
    ethnicity: {
      german: 84,
      turkish_russian_diaspora: 6,
      mena: 4,
      eu_southern_eastern: 3,
      other: 3,
    },
    age: { young: 15, mid: 21, mature: 37, senior: 27 },
    education: { no_degree: 13, berufsausbildung: 43, abitur: 19, hochschulabschluss: 25 },
    income: { low: 21, middle: 53, high: 26 },
    urbanization: { urban: 33, suburban: 35, rural: 32 },
  },
  SL: {
    ethnicity: {
      german: 85,
      turkish_russian_diaspora: 5,
      mena: 3,
      eu_southern_eastern: 4,
      other: 3,
    },
    age: { young: 13, mid: 20, mature: 37, senior: 30 },
    education: { no_degree: 13, berufsausbildung: 47, abitur: 18, hochschulabschluss: 22 },
    income: { low: 24, middle: 54, high: 22 },
    urbanization: { urban: 35, suburban: 40, rural: 25 },
  },

  // ── Norden ─────────────────────────────────────────────────────────────────
  NI: {
    ethnicity: {
      german: 86,
      turkish_russian_diaspora: 6,
      mena: 3,
      eu_southern_eastern: 3,
      other: 2,
    },
    age: { young: 15, mid: 21, mature: 37, senior: 27 },
    education: { no_degree: 14, berufsausbildung: 44, abitur: 19, hochschulabschluss: 23 },
    income: { low: 22, middle: 52, high: 26 },
    urbanization: { urban: 38, suburban: 30, rural: 32 },
  },
  SH: {
    ethnicity: {
      german: 88,
      turkish_russian_diaspora: 5,
      mena: 3,
      eu_southern_eastern: 2,
      other: 2,
    },
    age: { young: 14, mid: 21, mature: 37, senior: 28 },
    education: { no_degree: 12, berufsausbildung: 42, abitur: 20, hochschulabschluss: 26 },
    income: { low: 22, middle: 52, high: 26 },
    urbanization: { urban: 30, suburban: 35, rural: 35 },
  },
  HH: {
    ethnicity: {
      german: 74,
      turkish_russian_diaspora: 7,
      mena: 7,
      eu_southern_eastern: 6,
      other: 6,
    },
    age: { young: 17, mid: 26, mature: 32, senior: 25 },
    education: { no_degree: 11, berufsausbildung: 29, abitur: 23, hochschulabschluss: 37 },
    income: { low: 22, middle: 43, high: 35 },
    urbanization: { urban: 100, suburban: 0, rural: 0 },
  },
  BRE: {
    ethnicity: {
      german: 72,
      turkish_russian_diaspora: 9,
      mena: 8,
      eu_southern_eastern: 5,
      other: 6,
    },
    age: { young: 17, mid: 25, mature: 33, senior: 25 },
    education: { no_degree: 14, berufsausbildung: 35, abitur: 21, hochschulabschluss: 30 },
    income: { low: 28, middle: 49, high: 23 },
    urbanization: { urban: 98, suburban: 2, rural: 0 },
  },

  // ── Osten ──────────────────────────────────────────────────────────────────
  BE: {
    ethnicity: {
      german: 65,
      turkish_russian_diaspora: 12,
      mena: 10,
      eu_southern_eastern: 7,
      other: 6,
    },
    age: { young: 17, mid: 28, mature: 32, senior: 23 },
    education: { no_degree: 10, berufsausbildung: 29, abitur: 24, hochschulabschluss: 37 },
    income: { low: 27, middle: 46, high: 27 },
    urbanization: { urban: 100, suburban: 0, rural: 0 },
  },
  BB: {
    ethnicity: {
      german: 88,
      turkish_russian_diaspora: 4,
      mena: 3,
      eu_southern_eastern: 3,
      other: 2,
    },
    age: { young: 11, mid: 19, mature: 37, senior: 33 },
    education: { no_degree: 9, berufsausbildung: 50, abitur: 17, hochschulabschluss: 24 },
    income: { low: 29, middle: 54, high: 17 },
    urbanization: { urban: 22, suburban: 29, rural: 49 },
  },
  MV: {
    ethnicity: {
      german: 90,
      turkish_russian_diaspora: 3,
      mena: 2,
      eu_southern_eastern: 3,
      other: 2,
    },
    age: { young: 10, mid: 20, mature: 38, senior: 32 },
    education: { no_degree: 11, berufsausbildung: 58, abitur: 14, hochschulabschluss: 17 },
    income: { low: 33, middle: 51, high: 16 },
    urbanization: { urban: 20, suburban: 18, rural: 62 },
  },
  SN: {
    ethnicity: {
      german: 90,
      turkish_russian_diaspora: 3,
      mena: 3,
      eu_southern_eastern: 2,
      other: 2,
    },
    age: { young: 13, mid: 16, mature: 38, senior: 33 },
    education: { no_degree: 10, berufsausbildung: 49, abitur: 18, hochschulabschluss: 23 },
    income: { low: 25, middle: 55, high: 20 },
    urbanization: { urban: 38, suburban: 30, rural: 32 },
  },
  ST: {
    ethnicity: {
      german: 94,
      turkish_russian_diaspora: 2,
      mena: 2,
      eu_southern_eastern: 1,
      other: 1,
    },
    age: { young: 12, mid: 17, mature: 37, senior: 34 },
    education: { no_degree: 11, berufsausbildung: 56, abitur: 15, hochschulabschluss: 18 },
    income: { low: 30, middle: 54, high: 16 },
    urbanization: { urban: 30, suburban: 28, rural: 42 },
  },
  TH: {
    ethnicity: {
      german: 94,
      turkish_russian_diaspora: 2,
      mena: 2,
      eu_southern_eastern: 1,
      other: 1,
    },
    age: { young: 12, mid: 18, mature: 37, senior: 33 },
    education: { no_degree: 10, berufsausbildung: 53, abitur: 17, hochschulabschluss: 20 },
    income: { low: 28, middle: 54, high: 18 },
    urbanization: { urban: 25, suburban: 28, rural: 47 },
  },
};
