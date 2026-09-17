/**
 * Germany Region Census Profiles, 2027 (Merz GroKo era).
 *
 * 2027-era companion to {@link deRegionCensusData2023} (the 2023 profiles).
 * All values are independently authored literals for 2027, never derived by
 * scaling another era's file in code. They continue the 2023 structure with
 * small documented projection drifts.
 *
 * 2027 projection assumptions (2023 bundle as the visible baseline):
 * - Ethnicity: net migration stays positive (Destatis Wanderungsstatistik,
 *   AZR Ukrainians counted under `turkish_russian_diaspora` as in 2023), so
 *   `other` rises 1 point in most Länder and the western metros pass 25%
 *   non-German adult share. Eastern Länder stay above 85% German.
 *   Source: Destatis Zensus 2022 plus Mikrozensus 2023-24
 *   (https://www.destatis.de/EN/Themes/Society-Environment/Population/_node.html).
 * - Age: every Land ages about 1 point from `young`/`mid` into `senior`;
 *   the East stays the oldest part of the EU (senior 33%+ outside Berlin).
 * - Education: tertiary expansion continues, so `hochschulabschluss` rises
 *   2 points funded from `no_degree`/`berufsausbildung`. Vocational Lehre
 *   stays dominant in the East.
 * - Income: inflation recovery moves about 1 point from `low` to `high`
 *   versus 2023. Source: Destatis VGR der Laender and EVS income tables.
 * - Urbanization: structural and held constant from 2023.
 *
 * NOTE: the shared Layer-1 model registry (`src/lib/seeds/international/`)
 * is outside this change's editable scope, so this bundle is consumed by
 * country-local tests for now. Wiring it into the Layer-1 era map is a
 * follow-up in shared code.
 */

import type { DERegionLayer1 } from "./deRegionCensusData";

export const deRegionCensusData2027: Record<string, DERegionLayer1> = {
  // ── Süden ──────────────────────────────────────────────────────────────────
  BW: {
    ethnicity: {
      german: 79,
      turkish_russian_diaspora: 8,
      mena: 4,
      eu_southern_eastern: 5,
      other: 4,
    },
    age: { young: 14, mid: 22, mature: 37, senior: 27 },
    education: { no_degree: 11, berufsausbildung: 39, abitur: 21, hochschulabschluss: 29 },
    income: { low: 18, middle: 51, high: 31 },
    urbanization: { urban: 51, suburban: 34, rural: 15 },
  },
  BY: {
    ethnicity: {
      german: 81,
      turkish_russian_diaspora: 7,
      mena: 4,
      eu_southern_eastern: 5,
      other: 3,
    },
    age: { young: 12, mid: 21, mature: 37, senior: 30 },
    education: { no_degree: 12, berufsausbildung: 39, abitur: 20, hochschulabschluss: 29 },
    income: { low: 17, middle: 51, high: 32 },
    urbanization: { urban: 44, suburban: 32, rural: 24 },
  },

  // ── Westen ─────────────────────────────────────────────────────────────────
  NW: {
    ethnicity: {
      german: 75,
      turkish_russian_diaspora: 9,
      mena: 6,
      eu_southern_eastern: 5,
      other: 5,
    },
    age: { young: 14, mid: 22, mature: 36, senior: 28 },
    education: { no_degree: 13, berufsausbildung: 39, abitur: 20, hochschulabschluss: 28 },
    income: { low: 22, middle: 51, high: 27 },
    urbanization: { urban: 60, suburban: 28, rural: 12 },
  },
  HE: {
    ethnicity: {
      german: 77,
      turkish_russian_diaspora: 7,
      mena: 5,
      eu_southern_eastern: 5,
      other: 6,
    },
    age: { young: 14, mid: 23, mature: 36, senior: 27 },
    education: { no_degree: 11, berufsausbildung: 35, abitur: 22, hochschulabschluss: 32 },
    income: { low: 19, middle: 49, high: 32 },
    urbanization: { urban: 49, suburban: 32, rural: 19 },
  },
  RP: {
    ethnicity: {
      german: 83,
      turkish_russian_diaspora: 6,
      mena: 4,
      eu_southern_eastern: 3,
      other: 4,
    },
    age: { young: 14, mid: 21, mature: 37, senior: 28 },
    education: { no_degree: 12, berufsausbildung: 42, abitur: 19, hochschulabschluss: 27 },
    income: { low: 20, middle: 53, high: 27 },
    urbanization: { urban: 33, suburban: 35, rural: 32 },
  },
  SL: {
    ethnicity: {
      german: 84,
      turkish_russian_diaspora: 5,
      mena: 3,
      eu_southern_eastern: 4,
      other: 4,
    },
    age: { young: 12, mid: 20, mature: 37, senior: 31 },
    education: { no_degree: 12, berufsausbildung: 46, abitur: 18, hochschulabschluss: 24 },
    income: { low: 23, middle: 54, high: 23 },
    urbanization: { urban: 35, suburban: 40, rural: 25 },
  },

  // ── Norden ─────────────────────────────────────────────────────────────────
  NI: {
    ethnicity: {
      german: 85,
      turkish_russian_diaspora: 6,
      mena: 3,
      eu_southern_eastern: 3,
      other: 3,
    },
    age: { young: 14, mid: 21, mature: 37, senior: 28 },
    education: { no_degree: 13, berufsausbildung: 43, abitur: 19, hochschulabschluss: 25 },
    income: { low: 21, middle: 52, high: 27 },
    urbanization: { urban: 38, suburban: 30, rural: 32 },
  },
  SH: {
    ethnicity: {
      german: 87,
      turkish_russian_diaspora: 5,
      mena: 3,
      eu_southern_eastern: 2,
      other: 3,
    },
    age: { young: 13, mid: 21, mature: 37, senior: 29 },
    education: { no_degree: 11, berufsausbildung: 41, abitur: 20, hochschulabschluss: 28 },
    income: { low: 21, middle: 52, high: 27 },
    urbanization: { urban: 30, suburban: 35, rural: 35 },
  },
  HH: {
    ethnicity: {
      german: 73,
      turkish_russian_diaspora: 7,
      mena: 7,
      eu_southern_eastern: 6,
      other: 7,
    },
    age: { young: 16, mid: 26, mature: 32, senior: 26 },
    education: { no_degree: 10, berufsausbildung: 28, abitur: 23, hochschulabschluss: 39 },
    income: { low: 21, middle: 43, high: 36 },
    urbanization: { urban: 100, suburban: 0, rural: 0 },
  },
  BRE: {
    ethnicity: {
      german: 71,
      turkish_russian_diaspora: 9,
      mena: 8,
      eu_southern_eastern: 5,
      other: 7,
    },
    age: { young: 16, mid: 25, mature: 33, senior: 26 },
    education: { no_degree: 13, berufsausbildung: 34, abitur: 21, hochschulabschluss: 32 },
    income: { low: 27, middle: 49, high: 24 },
    urbanization: { urban: 98, suburban: 2, rural: 0 },
  },

  // ── Osten ──────────────────────────────────────────────────────────────────
  BE: {
    ethnicity: {
      german: 64,
      turkish_russian_diaspora: 12,
      mena: 10,
      eu_southern_eastern: 7,
      other: 7,
    },
    age: { young: 16, mid: 28, mature: 32, senior: 24 },
    education: { no_degree: 9, berufsausbildung: 28, abitur: 24, hochschulabschluss: 39 },
    income: { low: 26, middle: 46, high: 28 },
    urbanization: { urban: 100, suburban: 0, rural: 0 },
  },
  BB: {
    ethnicity: {
      german: 87,
      turkish_russian_diaspora: 4,
      mena: 3,
      eu_southern_eastern: 3,
      other: 3,
    },
    age: { young: 10, mid: 19, mature: 37, senior: 34 },
    education: { no_degree: 8, berufsausbildung: 49, abitur: 17, hochschulabschluss: 26 },
    income: { low: 28, middle: 54, high: 18 },
    urbanization: { urban: 22, suburban: 29, rural: 49 },
  },
  MV: {
    ethnicity: {
      german: 89,
      turkish_russian_diaspora: 3,
      mena: 2,
      eu_southern_eastern: 3,
      other: 3,
    },
    age: { young: 9, mid: 20, mature: 38, senior: 33 },
    education: { no_degree: 10, berufsausbildung: 57, abitur: 14, hochschulabschluss: 19 },
    income: { low: 32, middle: 51, high: 17 },
    urbanization: { urban: 20, suburban: 18, rural: 62 },
  },
  SN: {
    ethnicity: {
      german: 89,
      turkish_russian_diaspora: 3,
      mena: 3,
      eu_southern_eastern: 2,
      other: 3,
    },
    age: { young: 12, mid: 16, mature: 38, senior: 34 },
    education: { no_degree: 9, berufsausbildung: 48, abitur: 18, hochschulabschluss: 25 },
    income: { low: 24, middle: 55, high: 21 },
    urbanization: { urban: 38, suburban: 30, rural: 32 },
  },
  ST: {
    ethnicity: {
      german: 93,
      turkish_russian_diaspora: 2,
      mena: 2,
      eu_southern_eastern: 1,
      other: 2,
    },
    age: { young: 11, mid: 17, mature: 37, senior: 35 },
    education: { no_degree: 10, berufsausbildung: 55, abitur: 15, hochschulabschluss: 20 },
    income: { low: 29, middle: 54, high: 17 },
    urbanization: { urban: 30, suburban: 28, rural: 42 },
  },
  TH: {
    ethnicity: {
      german: 93,
      turkish_russian_diaspora: 2,
      mena: 2,
      eu_southern_eastern: 1,
      other: 2,
    },
    age: { young: 11, mid: 18, mature: 37, senior: 34 },
    education: { no_degree: 9, berufsausbildung: 52, abitur: 17, hochschulabschluss: 22 },
    income: { low: 27, middle: 54, high: 19 },
    urbanization: { urban: 25, suburban: 28, rural: 47 },
  },
};
