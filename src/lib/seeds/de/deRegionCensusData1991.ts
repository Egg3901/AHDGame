/**
 * Germany Region Census Profiles — 1991 (post-reunification) era.
 *
 * 1991-default companion to {@link deRegionCensusData} (the 2019 profiles).
 * Selected at render time via the preset registry when the world runs under
 * the `1991-default` reset preset.
 *
 * Sources / methodology (approximate, % of adult population):
 *   - West Länder: 1987 Volkszählung (Bundesrepublik) + Statistisches
 *     Bundesamt Mikrozensus 1991.
 *   - East Länder + Berlin: 1990/91 post-reunification estimates (very low
 *     migrant share — former GDR contract-worker populations were small and
 *     mostly counted under "other"; the GDR vocational system pushed
 *     `berufsausbildung` high and tertiary attainment low).
 *
 * Directional vs the 2019 profiles: higher `german` share everywhere, lower
 * `hochschulabschluss`, lower migrant share; the eastern Länder
 * (BB/MV/SN/ST/TH) and Berlin reflect 1991 reunification reality.
 */

import type { DERegionLayer1 } from "./deRegionCensusData";

export const deRegionCensusData1991: Record<string, DERegionLayer1> = {
  // ── Süden (West) ─────────────────────────────────────────────────────────
  BW: {
    ethnicity: {
      german: 85,
      turkish_russian_diaspora: 7,
      mena: 2,
      eu_southern_eastern: 4,
      other: 2,
    },
    age: { young: 20, mid: 23, mature: 34, senior: 23 },
    education: { no_degree: 20, berufsausbildung: 52, abitur: 15, hochschulabschluss: 13 },
    income: { low: 20, middle: 55, high: 25 },
    urbanization: { urban: 48, suburban: 35, rural: 17 },
  },
  BY: {
    ethnicity: {
      german: 87,
      turkish_russian_diaspora: 5,
      mena: 2,
      eu_southern_eastern: 4,
      other: 2,
    },
    age: { young: 19, mid: 23, mature: 34, senior: 24 },
    education: { no_degree: 22, berufsausbildung: 52, abitur: 13, hochschulabschluss: 13 },
    income: { low: 21, middle: 55, high: 24 },
    urbanization: { urban: 42, suburban: 30, rural: 28 },
  },

  // ── Westen ───────────────────────────────────────────────────────────────
  NW: {
    ethnicity: {
      german: 83,
      turkish_russian_diaspora: 8,
      mena: 3,
      eu_southern_eastern: 4,
      other: 2,
    },
    age: { young: 20, mid: 23, mature: 33, senior: 24 },
    education: { no_degree: 24, berufsausbildung: 51, abitur: 13, hochschulabschluss: 12 },
    income: { low: 24, middle: 54, high: 22 },
    urbanization: { urban: 60, suburban: 28, rural: 12 },
  },
  HE: {
    ethnicity: {
      german: 84,
      turkish_russian_diaspora: 6,
      mena: 3,
      eu_southern_eastern: 5,
      other: 2,
    },
    age: { young: 20, mid: 24, mature: 33, senior: 23 },
    education: { no_degree: 21, berufsausbildung: 49, abitur: 15, hochschulabschluss: 15 },
    income: { low: 21, middle: 53, high: 26 },
    urbanization: { urban: 48, suburban: 32, rural: 20 },
  },
  RP: {
    ethnicity: {
      german: 89,
      turkish_russian_diaspora: 4,
      mena: 2,
      eu_southern_eastern: 3,
      other: 2,
    },
    age: { young: 20, mid: 22, mature: 34, senior: 24 },
    education: { no_degree: 23, berufsausbildung: 54, abitur: 12, hochschulabschluss: 11 },
    income: { low: 23, middle: 56, high: 21 },
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
    age: { young: 19, mid: 22, mature: 34, senior: 25 },
    education: { no_degree: 23, berufsausbildung: 56, abitur: 11, hochschulabschluss: 10 },
    income: { low: 26, middle: 56, high: 18 },
    urbanization: { urban: 35, suburban: 40, rural: 25 },
  },

  // ── Norden (West) ────────────────────────────────────────────────────────
  NI: {
    ethnicity: {
      german: 90,
      turkish_russian_diaspora: 5,
      mena: 1,
      eu_southern_eastern: 2,
      other: 2,
    },
    age: { young: 20, mid: 22, mature: 34, senior: 24 },
    education: { no_degree: 24, berufsausbildung: 53, abitur: 12, hochschulabschluss: 11 },
    income: { low: 24, middle: 55, high: 21 },
    urbanization: { urban: 38, suburban: 30, rural: 32 },
  },
  SH: {
    ethnicity: {
      german: 92,
      turkish_russian_diaspora: 3,
      mena: 1,
      eu_southern_eastern: 2,
      other: 2,
    },
    age: { young: 19, mid: 22, mature: 34, senior: 25 },
    education: { no_degree: 22, berufsausbildung: 53, abitur: 13, hochschulabschluss: 12 },
    income: { low: 23, middle: 55, high: 22 },
    urbanization: { urban: 30, suburban: 35, rural: 35 },
  },
  HH: {
    ethnicity: {
      german: 82,
      turkish_russian_diaspora: 6,
      mena: 4,
      eu_southern_eastern: 5,
      other: 3,
    },
    age: { young: 21, mid: 26, mature: 30, senior: 23 },
    education: { no_degree: 20, berufsausbildung: 43, abitur: 18, hochschulabschluss: 19 },
    income: { low: 24, middle: 50, high: 26 },
    urbanization: { urban: 100, suburban: 0, rural: 0 },
  },
  BRE: {
    ethnicity: {
      german: 83,
      turkish_russian_diaspora: 7,
      mena: 4,
      eu_southern_eastern: 4,
      other: 2,
    },
    age: { young: 21, mid: 25, mature: 31, senior: 23 },
    education: { no_degree: 23, berufsausbildung: 47, abitur: 15, hochschulabschluss: 15 },
    income: { low: 28, middle: 52, high: 20 },
    urbanization: { urban: 98, suburban: 2, rural: 0 },
  },

  // ── Osten (former GDR) + Berlin ──────────────────────────────────────────
  BE: {
    ethnicity: {
      german: 85,
      turkish_russian_diaspora: 8,
      mena: 2,
      eu_southern_eastern: 3,
      other: 2,
    },
    age: { young: 21, mid: 25, mature: 31, senior: 23 },
    education: { no_degree: 20, berufsausbildung: 45, abitur: 18, hochschulabschluss: 17 },
    income: { low: 30, middle: 52, high: 18 },
    urbanization: { urban: 100, suburban: 0, rural: 0 },
  },
  BB: {
    ethnicity: {
      german: 98,
      turkish_russian_diaspora: 1,
      mena: 0,
      eu_southern_eastern: 0,
      other: 1,
    },
    age: { young: 19, mid: 23, mature: 35, senior: 23 },
    education: { no_degree: 16, berufsausbildung: 62, abitur: 11, hochschulabschluss: 11 },
    income: { low: 42, middle: 50, high: 8 },
    urbanization: { urban: 22, suburban: 28, rural: 50 },
  },
  MV: {
    ethnicity: {
      german: 98,
      turkish_russian_diaspora: 1,
      mena: 0,
      eu_southern_eastern: 0,
      other: 1,
    },
    age: { young: 20, mid: 23, mature: 34, senior: 23 },
    education: { no_degree: 16, berufsausbildung: 64, abitur: 10, hochschulabschluss: 10 },
    income: { low: 45, middle: 48, high: 7 },
    urbanization: { urban: 18, suburban: 22, rural: 60 },
  },
  SN: {
    ethnicity: {
      german: 98,
      turkish_russian_diaspora: 1,
      mena: 0,
      eu_southern_eastern: 0,
      other: 1,
    },
    age: { young: 19, mid: 23, mature: 35, senior: 23 },
    education: { no_degree: 14, berufsausbildung: 62, abitur: 12, hochschulabschluss: 12 },
    income: { low: 40, middle: 52, high: 8 },
    urbanization: { urban: 38, suburban: 30, rural: 32 },
  },
  ST: {
    ethnicity: {
      german: 98,
      turkish_russian_diaspora: 1,
      mena: 0,
      eu_southern_eastern: 0,
      other: 1,
    },
    age: { young: 19, mid: 23, mature: 35, senior: 23 },
    education: { no_degree: 17, berufsausbildung: 63, abitur: 10, hochschulabschluss: 10 },
    income: { low: 43, middle: 49, high: 8 },
    urbanization: { urban: 30, suburban: 28, rural: 42 },
  },
  TH: {
    ethnicity: {
      german: 98,
      turkish_russian_diaspora: 1,
      mena: 0,
      eu_southern_eastern: 0,
      other: 1,
    },
    age: { young: 19, mid: 23, mature: 35, senior: 23 },
    education: { no_degree: 15, berufsausbildung: 63, abitur: 11, hochschulabschluss: 11 },
    income: { low: 41, middle: 51, high: 8 },
    urbanization: { urban: 25, suburban: 28, rural: 47 },
  },
};
