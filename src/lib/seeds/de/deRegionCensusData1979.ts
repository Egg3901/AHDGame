/**
 * Germany Region Census Profiles — 1979 (divided-Germany) era.
 *
 * 1979-era companion to {@link deRegionCensusData} (the 2019 profiles).
 * All values independently authored from 1979 historical knowledge of each
 * Land — never derived by scaling another era's file.
 *
 * IMPORTANT design decision: Germany was divided in 1979, but the game keeps
 * a fixed Land set including the eastern Länder. The eastern Länder
 * (BB/MV/SN/ST/TH) are therefore authored with DDR-era socioeconomic
 * profiles so a 1979 world is playable with the same regions:
 *   - full-employment industrial economy (incomes state-compressed: a very
 *     large "middle" band, tiny "high" band — the nomenklatura and a few
 *     private craftsmen — and a modest "low" band of pensioners);
 *   - near-zero foreign population (Vietnamese/Mozambican contract workers
 *     arrived mostly in the 1980s; what little existed is under "other");
 *   - the polytechnic education system (POS/EOS + Facharbeiter training)
 *     mapped onto the file's buckets: 10-class POS + apprenticeship counted
 *     as `berufsausbildung` (dominant), EOS/Abitur capped at ~10–12% by
 *     state quota, university attainment ~10%, `no_degree` mostly the
 *     pre-war-schooled elderly.
 * Berlin (BE) is authored as a blended city: West Berlin's large Turkish
 * Gastarbeiter community plus East Berlin's DDR profile.
 *
 * West Länder anchor (1979): mature Wirtschaftswunder economy under Schmidt;
 * Gastarbeiter communities (Turks, Italians, Yugoslavs, Greeks) concentrated
 * in the industrial belts of NW, BW, HE and the city-states; recruitment had
 * stopped in 1973 but family reunification kept shares high. Education was
 * still dominated by Volksschule/Hauptschule + Lehre; tertiary attainment in
 * the adult population was low (~8–12%) despite the 1970s university
 * expansion. Adult age structure was young (large 1950s–60s cohorts), with
 * a notable senior share from pre-WWI cohorts.
 */

import type { DERegionLayer1 } from "./deRegionCensusData";

export const deRegionCensusData1979: Record<string, DERegionLayer1> = {
  // ── Süden (Bundesrepublik) ─────────────────────────────────────────────────
  BW: {
    ethnicity: {
      german: 88,
      turkish_russian_diaspora: 5,
      mena: 1,
      eu_southern_eastern: 5,
      other: 1,
    },
    age: { young: 24, mid: 25, mature: 31, senior: 20 },
    education: { no_degree: 30, berufsausbildung: 51, abitur: 10, hochschulabschluss: 9 },
    income: { low: 22, middle: 58, high: 20 },
    urbanization: { urban: 45, suburban: 35, rural: 20 },
  },
  BY: {
    ethnicity: {
      german: 91,
      turkish_russian_diaspora: 3,
      mena: 1,
      eu_southern_eastern: 4,
      other: 1,
    },
    age: { young: 24, mid: 24, mature: 31, senior: 21 },
    education: { no_degree: 33, berufsausbildung: 50, abitur: 9, hochschulabschluss: 8 },
    income: { low: 25, middle: 56, high: 19 },
    urbanization: { urban: 38, suburban: 28, rural: 34 },
  },

  // ── Westen (Bundesrepublik) ────────────────────────────────────────────────
  NW: {
    ethnicity: {
      german: 87,
      turkish_russian_diaspora: 6,
      mena: 1,
      eu_southern_eastern: 5,
      other: 1,
    },
    age: { young: 23, mid: 25, mature: 31, senior: 21 },
    education: { no_degree: 34, berufsausbildung: 50, abitur: 8, hochschulabschluss: 8 },
    income: { low: 23, middle: 57, high: 20 },
    urbanization: { urban: 60, suburban: 28, rural: 12 },
  },
  HE: {
    ethnicity: {
      german: 88,
      turkish_russian_diaspora: 5,
      mena: 1,
      eu_southern_eastern: 5,
      other: 1,
    },
    age: { young: 23, mid: 25, mature: 31, senior: 21 },
    education: { no_degree: 31, berufsausbildung: 49, abitur: 10, hochschulabschluss: 10 },
    income: { low: 22, middle: 56, high: 22 },
    urbanization: { urban: 46, suburban: 32, rural: 22 },
  },
  RP: {
    ethnicity: {
      german: 93,
      turkish_russian_diaspora: 3,
      mena: 0,
      eu_southern_eastern: 3,
      other: 1,
    },
    age: { young: 23, mid: 24, mature: 31, senior: 22 },
    education: { no_degree: 35, berufsausbildung: 50, abitur: 8, hochschulabschluss: 7 },
    income: { low: 26, middle: 57, high: 17 },
    urbanization: { urban: 30, suburban: 35, rural: 35 },
  },
  SL: {
    ethnicity: {
      german: 94,
      turkish_russian_diaspora: 2,
      mena: 0,
      eu_southern_eastern: 3,
      other: 1,
    },
    age: { young: 22, mid: 24, mature: 32, senior: 22 },
    // Saar coal/steel monostructure: apprenticed miners/steelworkers dominate
    // (Facharbeiter rather than unskilled), wages squeezed by the late-70s steel
    // crisis, and the Saarbrücken–Völklingen belt is denser than the Land's size
    // suggests.
    education: { no_degree: 29, berufsausbildung: 58, abitur: 7, hochschulabschluss: 6 },
    income: { low: 36, middle: 52, high: 12 },
    urbanization: { urban: 52, suburban: 32, rural: 16 },
  },

  // ── Norden (Bundesrepublik) ────────────────────────────────────────────────
  NI: {
    ethnicity: {
      german: 94,
      turkish_russian_diaspora: 2,
      mena: 0,
      eu_southern_eastern: 3,
      other: 1,
    },
    age: { young: 23, mid: 24, mature: 31, senior: 22 },
    education: { no_degree: 35, berufsausbildung: 50, abitur: 8, hochschulabschluss: 7 },
    income: { low: 26, middle: 57, high: 17 },
    urbanization: { urban: 36, suburban: 30, rural: 34 },
  },
  SH: {
    ethnicity: {
      german: 96,
      turkish_russian_diaspora: 1,
      mena: 0,
      eu_southern_eastern: 2,
      other: 1,
    },
    age: { young: 22, mid: 24, mature: 31, senior: 23 },
    education: { no_degree: 34, berufsausbildung: 50, abitur: 9, hochschulabschluss: 7 },
    income: { low: 25, middle: 57, high: 18 },
    urbanization: { urban: 28, suburban: 35, rural: 37 },
  },
  HH: {
    ethnicity: {
      german: 89,
      turkish_russian_diaspora: 4,
      mena: 1,
      eu_southern_eastern: 4,
      other: 2,
    },
    age: { young: 23, mid: 25, mature: 29, senior: 23 },
    education: { no_degree: 30, berufsausbildung: 45, abitur: 13, hochschulabschluss: 12 },
    income: { low: 23, middle: 53, high: 24 },
    urbanization: { urban: 100, suburban: 0, rural: 0 },
  },
  BRE: {
    ethnicity: {
      german: 90,
      turkish_russian_diaspora: 4,
      mena: 1,
      eu_southern_eastern: 4,
      other: 1,
    },
    age: { young: 23, mid: 25, mature: 30, senior: 22 },
    education: { no_degree: 33, berufsausbildung: 48, abitur: 10, hochschulabschluss: 9 },
    income: { low: 25, middle: 55, high: 20 },
    urbanization: { urban: 98, suburban: 2, rural: 0 },
  },

  // ── Osten (DDR) + Berlin (divided city, blended) ───────────────────────────
  BE: {
    ethnicity: {
      german: 91,
      turkish_russian_diaspora: 5,
      mena: 1,
      eu_southern_eastern: 2,
      other: 1,
    },
    age: { young: 22, mid: 24, mature: 30, senior: 24 },
    education: { no_degree: 26, berufsausbildung: 49, abitur: 13, hochschulabschluss: 12 },
    income: { low: 26, middle: 56, high: 18 },
    urbanization: { urban: 100, suburban: 0, rural: 0 },
  },
};
