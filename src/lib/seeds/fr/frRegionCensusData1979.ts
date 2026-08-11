/**
 * France Region Census Profiles — Layer 1 (1979, Fifth Republic / Giscard era).
 *
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Authored for ~1979 directly. NOT imported/transformed from frRegionCensusData1953.ts.
 * Primary sources: INSEE Recensement 1975, Labour Force Survey 1978.
 *
 * Key 1979 anchors vs 1953:
 * - Urbanization HIGHER: 73% urban (vs ~47% in 1953; Les Trente Glorieuses rural exodus)
 * - Education HIGHER: secondary near-majority; bac rate ~25%; university ~10%
 * - North African immigration MUCH HIGHER: post-1962 Algerian independence wave;
 *   ~1.5M Maghrebis resident by 1975; concentrated in IDF and MED regions
 * - European immigrant share LOWER: Italian/Spanish inter-war migrants now integrated
 * - Income: substantially higher nominal (Trente Glorieuses growth); still very
 *   blue-collar industrial in NOR/EST; service-economy in IDF
 * - Age: Trente Glorieuses baby boom cohort now 25–40; ageing less acute than 2019
 *
 * Dimension keys match FRRegionLayer1:
 *   ethnicity: french | european_immigrant | north_african | other
 *   education: primary_or_below | secondary | vocational | university
 *   age: young | mid | mature | senior
 *   income: low | middle | high
 *   urbanization: urban | suburban | rural
 * Each dimension sums to 100.
 */

import type { FRRegionLayer1 } from "./frRegionCensusData";

export const frRegionCensusData1979: Record<string, FRRegionLayer1> = {
  FR_IDF: {
    // Paris region: largest North African community; white-collar growth;
    // highest education nationally; post-war suburban banlieues expanding.
    ethnicity: { french: 83, european_immigrant: 5, north_african: 9, other: 3 },
    age: { young: 26, mid: 32, mature: 25, senior: 17 },
    education: { primary_or_below: 24, secondary: 40, vocational: 22, university: 14 },
    income: { low: 20, middle: 55, high: 25 },
    urbanization: { urban: 92, suburban: 6, rural: 2 },
  },
  FR_NOR: {
    // Nord-Pas-de-Calais / Normandy / Picardy: coal, steel, textiles declining;
    // post-1973 oil shock hitting industrial heartland hard. Maghrebi mine-workers.
    ethnicity: { french: 89, european_immigrant: 4, north_african: 5, other: 2 },
    age: { young: 28, mid: 30, mature: 25, senior: 17 },
    education: { primary_or_below: 34, secondary: 38, vocational: 22, university: 6 },
    income: { low: 30, middle: 54, high: 16 },
    urbanization: { urban: 68, suburban: 18, rural: 14 },
  },
  FR_EST: {
    // Alsace-Lorraine / Champagne-Ardenne: steel Lorraine in structural crisis;
    // Alsace more prosperous (German cross-border economy). Small Maghrebi presence.
    ethnicity: { french: 90, european_immigrant: 6, north_african: 3, other: 1 },
    age: { young: 26, mid: 30, mature: 26, senior: 18 },
    education: { primary_or_below: 30, secondary: 40, vocational: 22, university: 8 },
    income: { low: 24, middle: 56, high: 20 },
    urbanization: { urban: 70, suburban: 20, rural: 10 },
  },
  FR_OUE: {
    // Brittany / Pays de la Loire: post-war industrialisation of Nantes/Rennes;
    // still Catholic rural heartland; very low immigration; emigration to Paris slowing.
    ethnicity: { french: 98, european_immigrant: 1, north_african: 1, other: 0 },
    age: { young: 26, mid: 28, mature: 26, senior: 20 },
    education: { primary_or_below: 38, secondary: 38, vocational: 18, university: 6 },
    income: { low: 32, middle: 54, high: 14 },
    urbanization: { urban: 52, suburban: 22, rural: 26 },
  },
  FR_SOU: {
    // Aquitaine / Midi-Pyrénées: Toulouse aerospace growing; wine; Basque/Spanish
    // border region; Spanish Republican exile community partly integrated.
    ethnicity: { french: 92, european_immigrant: 5, north_african: 2, other: 1 },
    age: { young: 24, mid: 28, mature: 28, senior: 20 },
    education: { primary_or_below: 34, secondary: 38, vocational: 18, university: 10 },
    income: { low: 28, middle: 54, high: 18 },
    urbanization: { urban: 58, suburban: 22, rural: 20 },
  },
  FR_ARA: {
    // Rhône-Alpes / Auvergne: Lyon as France's second city; chemicals, textiles,
    // electronics. Large Italian-descended community (integrated). Some Maghrebis.
    ethnicity: { french: 87, european_immigrant: 7, north_african: 5, other: 1 },
    age: { young: 27, mid: 30, mature: 25, senior: 18 },
    education: { primary_or_below: 30, secondary: 40, vocational: 20, university: 10 },
    income: { low: 24, middle: 56, high: 20 },
    urbanization: { urban: 66, suburban: 22, rural: 12 },
  },
  FR_MED: {
    // Provence / Languedoc-Roussillon: Marseille — France's most North African city;
    // pied-noirs (repatriate Algerians) settled post-1962; wine, tourism, port.
    ethnicity: { french: 76, european_immigrant: 8, north_african: 14, other: 2 },
    age: { young: 26, mid: 28, mature: 26, senior: 20 },
    education: { primary_or_below: 32, secondary: 38, vocational: 18, university: 12 },
    income: { low: 30, middle: 50, high: 20 },
    urbanization: { urban: 72, suburban: 18, rural: 10 },
  },
  FR_CEN: {
    // Centre / Bourgogne / Franche-Comté: agricultural heartland; Dijon wine;
    // ageing population; low immigration. Still substantially rural.
    ethnicity: { french: 95, european_immigrant: 3, north_african: 1, other: 1 },
    age: { young: 22, mid: 27, mature: 28, senior: 23 },
    education: { primary_or_below: 38, secondary: 38, vocational: 18, university: 6 },
    income: { low: 28, middle: 56, high: 16 },
    urbanization: { urban: 50, suburban: 22, rural: 28 },
  },
};

export default frRegionCensusData1979;
