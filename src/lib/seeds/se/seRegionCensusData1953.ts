/**
 * Sweden Region Census Profiles — 1953 era.
 *
 * 1953-default companion to {@link seRegionCensusData} (the 1979 profiles).
 * Anchored on 1950 Swedish Census and Statistiska centralbyrån data.
 *
 * Era anchors: Sweden in 1953 is remarkably homogeneous — post-war immigration
 * barely exists outside a small Finnish labour contingent; the decisive axes are
 * urban (Stockholm / Göteborg) vs. the rural interior and Norrland. Social
 * Democrats have governed continuously since 1932; the welfare state is
 * expanding but has not yet reached the heights of the 1970s. University
 * attendance is below 4% everywhere. Agriculture still employs ~20% of the
 * workforce. Norrland is sparsely settled; Stockholm is the sole metropolis.
 * The Sámi minority (~10K) lives almost entirely in Norrland.
 *
 * SEED INDEPENDENCE — all values independently authored from 1953 historical
 * knowledge; NOT scaled from any other era file.
 */

import type { SERegionLayer1 } from "./seRegionCensusData";

export const seRegionCensusData1953: Record<string, SERegionLayer1> = {
  SE_STH: {
    // Stockholm: cosmopolitan commercial hub; highest education and income in Sweden
    ethnicity: { swedish: 98, immigrant: 1, other: 1 },
    age: { young: 18, mid: 26, mature: 31, senior: 25 },
    education: { primary_or_below: 55, secondary: 28, vocational: 12, university: 5 },
    income: { low: 22, middle: 55, high: 23 },
    urbanization: { urban: 90, suburban: 8, rural: 2 },
  },
  SE_GOT: {
    // Göteborg: shipbuilding and engineering; heavily working-class Social Democrat
    ethnicity: { swedish: 99, immigrant: 1, other: 0 },
    age: { young: 20, mid: 27, mature: 31, senior: 22 },
    education: { primary_or_below: 58, secondary: 28, vocational: 11, university: 3 },
    income: { low: 26, middle: 57, high: 17 },
    urbanization: { urban: 76, suburban: 12, rural: 12 },
  },
  SE_SKA: {
    // Skåne: mixed farming/industry; fertile plains; Malmö as regional centre
    ethnicity: { swedish: 99, immigrant: 1, other: 0 },
    age: { young: 19, mid: 26, mature: 32, senior: 23 },
    education: { primary_or_below: 62, secondary: 26, vocational: 9, university: 3 },
    income: { low: 28, middle: 58, high: 14 },
    urbanization: { urban: 55, suburban: 14, rural: 31 },
  },
  SE_EAS: {
    // Eastern Sweden (Östergötland/Linköping): manufacturing but largely rural
    ethnicity: { swedish: 99, immigrant: 1, other: 0 },
    age: { young: 18, mid: 25, mature: 32, senior: 25 },
    education: { primary_or_below: 63, secondary: 25, vocational: 9, university: 3 },
    income: { low: 28, middle: 59, high: 13 },
    urbanization: { urban: 52, suburban: 14, rural: 34 },
  },
  SE_SML: {
    // Småland: rural with small export industry; conservative religious nonconformists
    ethnicity: { swedish: 99, immigrant: 1, other: 0 },
    age: { young: 17, mid: 24, mature: 32, senior: 27 },
    education: { primary_or_below: 66, secondary: 24, vocational: 8, university: 2 },
    income: { low: 30, middle: 59, high: 11 },
    urbanization: { urban: 40, suburban: 14, rural: 46 },
  },
  SE_VML: {
    // Bergslagen: iron ore mining, steelmaking; strong trade-union density
    ethnicity: { swedish: 99, immigrant: 1, other: 0 },
    age: { young: 20, mid: 27, mature: 32, senior: 21 },
    education: { primary_or_below: 62, secondary: 25, vocational: 10, university: 3 },
    income: { low: 26, middle: 61, high: 13 },
    urbanization: { urban: 56, suburban: 12, rural: 32 },
  },
  SE_NOR: {
    // Norrland: vast, sparsely populated; forestry, hydropower; small Sámi minority
    ethnicity: { swedish: 97, immigrant: 1, other: 2 },
    age: { young: 21, mid: 26, mature: 32, senior: 21 },
    education: { primary_or_below: 66, secondary: 23, vocational: 9, university: 2 },
    income: { low: 30, middle: 60, high: 10 },
    urbanization: { urban: 35, suburban: 12, rural: 53 },
  },
  SE_UPP: {
    // Uppsala & Dalarna: Uppsala University lifts education; mixed rural hinterland
    ethnicity: { swedish: 99, immigrant: 1, other: 0 },
    age: { young: 24, mid: 27, mature: 30, senior: 19 },
    education: { primary_or_below: 56, secondary: 25, vocational: 10, university: 9 },
    income: { low: 24, middle: 58, high: 18 },
    urbanization: { urban: 48, suburban: 14, rural: 38 },
  },
};

export default seRegionCensusData1953;
