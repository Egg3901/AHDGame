/**
 * Spain Region Census Profiles — Layer 1 (1953, Francoist autarky).
 *
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Anchored on 1950 Census of Spain. NOT imported/transformed from esRegionCensusData.ts.
 *
 * Key 1953 anchors (vs 1979):
 * - Education: MUCH HIGHER primary_or_below — illiteracy ~11% nationally (1950
 *   Census); rural areas much worse. University <2% of adults.
 * - Urbanization: LOWER urban — ~49% of workforce in agriculture (1950); rural
 *   to urban migration to Catalonia/Madrid barely begun.
 * - Ethnicity "regional": regional identity (Catalan, Basque, Galician) was
 *   suppressed under Franco, but the populations exist. Mapped to `regional`
 *   key to capture underlying nationalist alignment potential.
 * - Income: much lower and more compressed (autarky; post-Civil-War poverty).
 * - Age: somewhat younger — high fertility; pre-baby-boom era.
 *
 * Dimension keys match ESRegionLayer1:
 *   ethnicity: spanish | regional | other
 *   education: primary_or_below | secondary | vocational | university
 *   age: young | mid | mature | senior
 *   income: low | middle | high
 *   urbanization: urban | suburban | rural
 *
 * Note: "regional" in 1953 reflects Catalan/Basque/Galician populations,
 * even though Franco suppressed their political expression. This captures
 * the underlying demographic/alignment potential.
 */

import type { ESRegionLayer1 } from "./esRegionCensusData";

export const esRegionCensusData1953: Record<string, ESRegionLayer1> = {
  ES_MAD: {
    // Madrid: administrative capital, military, Catholic Church bureaucracy,
    // regime elites, growing public sector. Most educated by Spanish standards.
    ethnicity: { spanish: 97, regional: 0, other: 3 },
    age: { young: 29, mid: 28, mature: 24, senior: 19 },
    education: { primary_or_below: 30, secondary: 20, vocational: 42, university: 8 },
    income: { low: 28, middle: 52, high: 20 },
    urbanization: { urban: 72, suburban: 16, rural: 12 },
  },
  ES_CAT: {
    // Catalonia: Spain's industrial powerhouse (Barcelona textiles, chemicals).
    // Language suppressed. Catalan bourgeoisie accommodated the regime.
    ethnicity: { spanish: 72, regional: 26, other: 2 }, // Catalan-identity majority
    age: { young: 28, mid: 27, mature: 25, senior: 20 },
    education: { primary_or_below: 22, secondary: 22, vocational: 48, university: 8 },
    income: { low: 20, middle: 56, high: 24 },
    urbanization: { urban: 64, suburban: 22, rural: 14 },
  },
  ES_AND: {
    // Andalusia: latifundia, braceros, deep poverty, mass emigration north.
    // Very high illiteracy. Civil War devastation still visible.
    ethnicity: { spanish: 99, regional: 0, other: 1 },
    age: { young: 32, mid: 27, mature: 23, senior: 18 },
    education: { primary_or_below: 56, secondary: 8, vocational: 33, university: 3 },
    income: { low: 65, middle: 30, high: 5 },
    urbanization: { urban: 30, suburban: 16, rural: 54 },
  },
  ES_VAL: {
    // Valencia & Murcia: citrus/rice agriculture, some industry in Valencia city.
    ethnicity: { spanish: 76, regional: 22, other: 2 }, // Valencian-identity population
    age: { young: 30, mid: 27, mature: 24, senior: 19 },
    education: { primary_or_below: 40, secondary: 15, vocational: 40, university: 5 },
    income: { low: 42, middle: 46, high: 12 },
    urbanization: { urban: 40, suburban: 20, rural: 40 },
  },
  ES_PVB: {
    // Basque Country & Navarre: Spain's most industrialized region outside
    // Catalonia (Bilbao steel/shipbuilding). Basque nationalism under suppression.
    ethnicity: { spanish: 62, regional: 36, other: 2 }, // Basque-identity significant
    age: { young: 27, mid: 28, mature: 26, senior: 19 },
    education: { primary_or_below: 24, secondary: 22, vocational: 46, university: 8 },
    income: { low: 22, middle: 54, high: 24 },
    urbanization: { urban: 58, suburban: 22, rural: 20 },
  },
  ES_GAL: {
    // Galicia: Franco's home region. Rural, fishing, smallholder agriculture,
    // mass emigration to South America. Very poor; Galician identity suppressed.
    ethnicity: { spanish: 68, regional: 30, other: 2 }, // Galician-identity significant
    age: { young: 27, mid: 26, mature: 26, senior: 21 },
    education: { primary_or_below: 44, secondary: 13, vocational: 37, university: 6 },
    income: { low: 55, middle: 38, high: 7 },
    urbanization: { urban: 22, suburban: 14, rural: 64 },
  },
  ES_NOR: {
    // Northern Spain (Asturias/Cantabria/Aragon/Rioja): coal, steel, wine.
    // Asturian miners were regime opponents; mixed industrial-rural.
    ethnicity: { spanish: 97, regional: 2, other: 1 },
    age: { young: 28, mid: 27, mature: 25, senior: 20 },
    education: { primary_or_below: 32, secondary: 18, vocational: 44, university: 6 },
    income: { low: 36, middle: 50, high: 14 },
    urbanization: { urban: 44, suburban: 20, rural: 36 },
  },
  ES_CEN: {
    // Central Spain (Castile-La Mancha/Extremadura/Balearics/Canarias):
    // wheat, sheep, subsistence farming. Core of Francoist "Old Castile".
    ethnicity: { spanish: 98, regional: 1, other: 1 },
    age: { young: 29, mid: 27, mature: 24, senior: 20 },
    education: { primary_or_below: 48, secondary: 11, vocational: 36, university: 5 },
    income: { low: 48, middle: 42, high: 10 },
    urbanization: { urban: 28, suburban: 16, rural: 56 },
  },
};

export default esRegionCensusData1953;
