/**
 * Germany (FRG) Region Census Profiles — 1953 era.
 *
 * 1953-default companion to {@link deRegionCensusData} (the 2019 profiles).
 * Anchored on West German Volkszählung 1950 and 1961 microdata.
 *
 * Era anchors (Adenauer's FRG / post-currency-reform boom): the 1948 Deutsche
 * Mark reform had ended hyperinflation; the Wirtschaftswunder was just starting
 * (real GDP grew ~7-10% p.a. 1950–1957) but the average income was still low;
 * Gastarbeiter recruitment had NOT yet begun (first treaty with Italy was 1955)
 * so the foreign population was almost entirely Heimatvertriebene (expellees
 * from the east) and DP-camp survivors — counted here as "german" since they
 * were ethnically German or had been absorbed; education was recovering from
 * WWII disruptions — Volksschule + Lehre dominated, Abitur rare (~7%), and
 * university attainment in the adult stock was very low (~5-6%) due to lost
 * student cohorts 1940–1946. Age structure: the large 1930s cohorts (now
 * 20-25) enter the labour force; a large senior cohort from WWI survivors;
 * the 1945 birth cohort is just 8 — so "young" (18-29) is thinner than 1979.
 *
 * The game keeps a unified Land set; for 1953 all regions model FRG (West).
 * The divided Berlin is modelled as the West Berlin rump only.
 *
 * All values independently authored — NOT scaled from any other era's file.
 */

import type { DERegionLayer1 } from "./deRegionCensusData";

export const deRegionCensusData1953: Record<string, DERegionLayer1> = {
  // ── Süden ─────────────────────────────────────────────────────────────────
  BW: {
    // Baden-Württemberg: newly merged Land (1952); mix of Protestant north and
    // Catholic south; large expellee influx from Sudetenland swells rural towns.
    ethnicity: {
      german: 98,
      turkish_russian_diaspora: 0,
      mena: 0,
      eu_southern_eastern: 1,
      other: 1,
    },
    age: { young: 21, mid: 23, mature: 31, senior: 25 },
    education: { no_degree: 40, berufsausbildung: 48, abitur: 7, hochschulabschluss: 5 },
    income: { low: 35, middle: 56, high: 9 },
    urbanization: { urban: 38, suburban: 32, rural: 30 },
  },
  BY: {
    // Bavaria: heavily Catholic and agricultural; Munich still rebuilding;
    // large Sudeten German expellee camps in Franconia.
    ethnicity: {
      german: 99,
      turkish_russian_diaspora: 0,
      mena: 0,
      eu_southern_eastern: 1,
      other: 0,
    },
    age: { young: 21, mid: 22, mature: 31, senior: 26 },
    education: { no_degree: 44, berufsausbildung: 46, abitur: 6, hochschulabschluss: 4 },
    income: { low: 38, middle: 54, high: 8 },
    urbanization: { urban: 30, suburban: 26, rural: 44 },
  },

  // ── Westen ────────────────────────────────────────────────────────────────
  NW: {
    // Nordrhein-Westfalen: Ruhr coal and steel at maximum output;
    // the industrial belt is the economic engine of the new republic.
    ethnicity: {
      german: 98,
      turkish_russian_diaspora: 0,
      mena: 0,
      eu_southern_eastern: 1,
      other: 1,
    },
    age: { young: 22, mid: 24, mature: 32, senior: 22 },
    education: { no_degree: 42, berufsausbildung: 49, abitur: 6, hochschulabschluss: 3 },
    income: { low: 30, middle: 59, high: 11 },
    urbanization: { urban: 58, suburban: 28, rural: 14 },
  },
  HE: {
    ethnicity: {
      german: 98,
      turkish_russian_diaspora: 0,
      mena: 0,
      eu_southern_eastern: 1,
      other: 1,
    },
    age: { young: 21, mid: 23, mature: 31, senior: 25 },
    education: { no_degree: 40, berufsausbildung: 48, abitur: 7, hochschulabschluss: 5 },
    income: { low: 32, middle: 57, high: 11 },
    urbanization: { urban: 38, suburban: 30, rural: 32 },
  },
  RP: {
    // Rhineland-Palatinate: wine-growing, Catholic, rural; French-occupied zone.
    ethnicity: {
      german: 99,
      turkish_russian_diaspora: 0,
      mena: 0,
      eu_southern_eastern: 1,
      other: 0,
    },
    age: { young: 21, mid: 22, mature: 31, senior: 26 },
    education: { no_degree: 44, berufsausbildung: 48, abitur: 5, hochschulabschluss: 3 },
    income: { low: 36, middle: 57, high: 7 },
    urbanization: { urban: 23, suburban: 33, rural: 44 },
  },
  SL: {
    // Saarland: still under French protectorate (rejoined FRG 1957);
    // coal and steel monoculture.
    ethnicity: {
      german: 99,
      turkish_russian_diaspora: 0,
      mena: 0,
      eu_southern_eastern: 1,
      other: 0,
    },
    age: { young: 21, mid: 23, mature: 32, senior: 24 },
    education: { no_degree: 46, berufsausbildung: 48, abitur: 4, hochschulabschluss: 2 },
    income: { low: 34, middle: 58, high: 8 },
    urbanization: { urban: 30, suburban: 38, rural: 32 },
  },

  // ── Norden ────────────────────────────────────────────────────────────────
  NI: {
    // Lower Saxony: large expellee population from Pomerania; mix of farmland
    // and Volkswagen (Wolfsburg just opened 1945, ramping in 1953).
    ethnicity: {
      german: 99,
      turkish_russian_diaspora: 0,
      mena: 0,
      eu_southern_eastern: 1,
      other: 0,
    },
    age: { young: 21, mid: 22, mature: 31, senior: 26 },
    education: { no_degree: 44, berufsausbildung: 48, abitur: 5, hochschulabschluss: 3 },
    income: { low: 36, middle: 57, high: 7 },
    urbanization: { urban: 29, suburban: 29, rural: 42 },
  },
  SH: {
    // Schleswig-Holstein: very high expellee share (nearly 1/3 from E. Prussia);
    // fishing, farming, and Kiel shipyards.
    ethnicity: {
      german: 99,
      turkish_russian_diaspora: 0,
      mena: 0,
      eu_southern_eastern: 1,
      other: 0,
    },
    age: { young: 20, mid: 22, mature: 31, senior: 27 },
    education: { no_degree: 44, berufsausbildung: 48, abitur: 6, hochschulabschluss: 2 },
    income: { low: 36, middle: 57, high: 7 },
    urbanization: { urban: 22, suburban: 33, rural: 45 },
  },
  HH: {
    // Hamburg: port city, trade and banking; most cosmopolitan city in FRG.
    ethnicity: {
      german: 97,
      turkish_russian_diaspora: 0,
      mena: 0,
      eu_southern_eastern: 2,
      other: 1,
    },
    age: { young: 21, mid: 23, mature: 31, senior: 25 },
    education: { no_degree: 36, berufsausbildung: 44, abitur: 11, hochschulabschluss: 9 },
    income: { low: 28, middle: 55, high: 17 },
    urbanization: { urban: 100, suburban: 0, rural: 0 },
  },
  BRE: {
    // Bremen: port and shipbuilding; strong SPD base.
    ethnicity: {
      german: 98,
      turkish_russian_diaspora: 0,
      mena: 0,
      eu_southern_eastern: 1,
      other: 1,
    },
    age: { young: 21, mid: 23, mature: 31, senior: 25 },
    education: { no_degree: 40, berufsausbildung: 47, abitur: 8, hochschulabschluss: 5 },
    income: { low: 30, middle: 57, high: 13 },
    urbanization: { urban: 98, suburban: 2, rural: 0 },
  },

  // ── Berlin (West only — divided city) ─────────────────────────────────────
  BE: {
    // West Berlin: isolated enclave; still rebuilding from wartime destruction;
    // young population has fled east or was killed; predominantly older.
    ethnicity: {
      german: 99,
      turkish_russian_diaspora: 0,
      mena: 0,
      eu_southern_eastern: 1,
      other: 0,
    },
    age: { young: 18, mid: 22, mature: 31, senior: 29 },
    education: { no_degree: 34, berufsausbildung: 47, abitur: 11, hochschulabschluss: 8 },
    income: { low: 32, middle: 56, high: 12 },
    urbanization: { urban: 100, suburban: 0, rural: 0 },
  },
};
