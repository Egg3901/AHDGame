/**
 * East Germany Region Census Profiles — Layer 1 (1953, the nascent GDR).
 *
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Authored for ~1953 directly. NOT imported/transformed from ddRegionCensusData.ts.
 *
 * Keyed to the same eastern-Länder codes as the 1979 bundle (BEO/MV/BB/ST/SN/TH)
 * — matching ddRegions1953.ts.
 *
 * Key 1953 anchors (vs 1979):
 * - Education: HIGHER primary_or_below — the 1952 education reform was brand-new;
 *   polytechnic secondary not yet universal; vocational Berufsschule dominant.
 * - Urbanization: LOWER urban — East Berlin still recovering; the north
 *   more agrarian than 1979.
 * - Age: HIGHER young (born 1930s-40s baby-lull + postwar bump) but also
 *   higher senior share (WWII survivors who didn't flee); mid cohort thinned by war.
 * - Income: more compressed (hardship levelling + SED wage policy).
 * - Ethnicity: near-monoethnic German; small group of expelled Silesians/Sudeten
 *   Germans still settling; negligible other.
 *
 * Each dimension sums to 100 (%).
 */

import type { DDRegionLayer1 } from "./ddRegionCensusData";

export const ddRegionCensusData1953: Record<string, DDRegionLayer1> = {
  BEO: {
    // East Berlin 1953: capital, administrative elite, workers' uprising June 17
    ethnicity: { german: 98, other: 2 },
    age: { young: 30, mid: 24, mature: 26, senior: 20 }, // WWII-depleted mid cohort
    education: { primary_or_below: 32, secondary: 28, vocational: 30, university: 10 },
    income: { low: 28, middle: 60, high: 12 },
    urbanization: { urban: 95, suburban: 5, rural: 0 },
  },
  MV: {
    // Agrarian Baltic coast; the Republic's most rural Land, swollen by expellees
    ethnicity: { german: 98, other: 2 },
    age: { young: 29, mid: 24, mature: 26, senior: 21 },
    education: { primary_or_below: 48, secondary: 27, vocational: 22, university: 3 },
    income: { low: 42, middle: 53, high: 5 },
    urbanization: { urban: 32, suburban: 12, rural: 56 },
  },
  BB: {
    // Brandenburg: Berlin's agrarian ring plus Frankfurt/Oder and Cottbus lignite
    ethnicity: { german: 98, other: 2 },
    age: { young: 28, mid: 25, mature: 26, senior: 21 },
    education: { primary_or_below: 44, secondary: 28, vocational: 24, university: 4 },
    income: { low: 38, middle: 56, high: 6 },
    urbanization: { urban: 38, suburban: 16, rural: 46 },
  },
  ST: {
    // Sachsen-Anhalt: the Halle/Magdeburg chemical belt amid farm country
    ethnicity: { german: 98, other: 2 },
    age: { young: 28, mid: 25, mature: 26, senior: 21 },
    education: { primary_or_below: 40, secondary: 28, vocational: 27, university: 5 },
    income: { low: 34, middle: 59, high: 7 },
    urbanization: { urban: 48, suburban: 14, rural: 38 },
  },
  SN: {
    // Sachsen: the industrial heartland (Dresden/Leipzig/Karl-Marx-Stadt)
    ethnicity: { german: 98, other: 2 },
    age: { young: 28, mid: 25, mature: 27, senior: 20 },
    education: { primary_or_below: 34, secondary: 28, vocational: 31, university: 7 },
    income: { low: 28, middle: 63, high: 9 },
    urbanization: { urban: 66, suburban: 14, rural: 20 },
  },
  TH: {
    // Thüringen: Erfurt/Gera/Jena workshops, Suhl, and the Wismut uranium fields
    ethnicity: { german: 98, other: 2 },
    age: { young: 28, mid: 25, mature: 27, senior: 20 },
    education: { primary_or_below: 38, secondary: 28, vocational: 28, university: 6 },
    income: { low: 32, middle: 60, high: 8 },
    urbanization: { urban: 52, suburban: 15, rural: 33 },
  },
};

export default ddRegionCensusData1953;
