/**
 * Hungary Layer-1 census (1953, the Rákosi years), one entry per region.
 * Each dim sums 100.
 *
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Authored for ~1953 directly, keyed to the same region codes as the 1979
 * bundle (matching huRegions1953.ts).
 *
 * Key 1953 anchors (vs 1979):
 * - Hungary is still a peasant country: the 1949 census put well over half the
 *   workforce in agriculture, and the first collectivisation drive is bitterly
 *   resisted (it collapses outright after 1956). Rural shares are far higher
 *   than 1979 everywhere outside Budapest.
 * - Education: the eight-grade general school is brand new (1945-48), so the
 *   adult stock is overwhelmingly six grades or less; the gimnázium and
 *   technikum streams have barely begun to widen.
 * - Age: postwar baby boom plus the 1953 Ratkó decree (abortion banned, childless
 *   tax) — the young cohort is the largest it will ever be.
 * - Income: near-total levelling under the 1950-54 forced-industrialisation plan,
 *   with compulsory produce deliveries stripping the countryside.
 * - Ethnicity: the 1946-48 expulsion of the Danube Swabians has just cut the
 *   German minority sharply, but Southern Transdanubia still carries the largest
 *   remainder; the north keeps its Slovak villages.
 */

import type { HURegionLayer1 } from "./huRegionCensusData";

export const huRegionCensusData1953: Record<string, HURegionLayer1> = {
  HU_BUD: {
    // Budapest: the one genuinely metropolitan region; siege damage still visible
    ethnicity: { hungarian: 98, minority: 1, other: 1 },
    age: { young: 27, mid: 28, mature: 25, senior: 20 },
    education: { primary_or_below: 54, secondary: 27, vocational: 14, university: 5 },
    income: { low: 30, middle: 64, high: 6 },
    urbanization: { urban: 88, suburban: 9, rural: 3 },
  },
  HU_PES: {
    // Pest county: the capital's agrarian hinterland, not yet a commuter belt
    ethnicity: { hungarian: 96, minority: 3, other: 1 },
    age: { young: 31, mid: 28, mature: 23, senior: 18 },
    education: { primary_or_below: 72, secondary: 19, vocational: 8, university: 1 },
    income: { low: 46, middle: 52, high: 2 },
    urbanization: { urban: 24, suburban: 24, rural: 52 },
  },
  HU_TRW: {
    // Western Transdanubia: Győr engineering plus the sealed Austrian frontier
    ethnicity: { hungarian: 95, minority: 4, other: 1 },
    age: { young: 30, mid: 28, mature: 24, senior: 18 },
    education: { primary_or_below: 70, secondary: 20, vocational: 9, university: 1 },
    income: { low: 44, middle: 54, high: 2 },
    urbanization: { urban: 34, suburban: 11, rural: 55 },
  },
  HU_TRS: {
    // Southern Transdanubia: Pécs coal, and the largest surviving Swabian villages
    ethnicity: { hungarian: 91, minority: 8, other: 1 },
    age: { young: 30, mid: 28, mature: 24, senior: 18 },
    education: { primary_or_below: 74, secondary: 18, vocational: 7, university: 1 },
    income: { low: 50, middle: 48, high: 2 },
    urbanization: { urban: 30, suburban: 10, rural: 60 },
  },
  HU_NOR: {
    // Northern Hungary: Miskolc/Ózd heavy industry driven hard by the plan
    ethnicity: { hungarian: 93, minority: 6, other: 1 },
    age: { young: 32, mid: 28, mature: 23, senior: 17 },
    education: { primary_or_below: 76, secondary: 17, vocational: 6, university: 1 },
    income: { low: 50, middle: 48, high: 2 },
    urbanization: { urban: 32, suburban: 11, rural: 57 },
  },
  HU_ALF: {
    // Great Plain: the deepest peasant Hungary; compulsory deliveries bite hardest
    ethnicity: { hungarian: 95, minority: 4, other: 1 },
    age: { young: 32, mid: 28, mature: 23, senior: 17 },
    education: { primary_or_below: 78, secondary: 16, vocational: 5, university: 1 },
    income: { low: 54, middle: 44, high: 2 },
    urbanization: { urban: 26, suburban: 9, rural: 65 },
  },
};
export default huRegionCensusData1953;
