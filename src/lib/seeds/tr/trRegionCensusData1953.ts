/**
 * Turkey Region Census Profiles — 1953 era.
 *
 * 1953-default companion to {@link trRegionCensusData} (the 1979 profiles).
 * Anchored on 1950 Turkish Census and contemporary demographic studies.
 *
 * Era anchors: Turkey in 1953 is overwhelmingly rural (~75% agricultural), very
 * young (high fertility, life expectancy ~50), and poorly educated (literacy
 * ≈ 34% nationally). The Democrat Party under Menderes is redistributing land
 * and mechanising agriculture; Marshall Plan aid is modernising infrastructure.
 * Istanbul retains a Greek, Armenian, and Jewish minority (~5%) that will be
 * decimated by the September 1955 pogrom. The Turkish/Kurdish ethnic divide is
 * politically suppressed but demographically real — concentrated in the east and
 * southeast. Ankara is a planned capital city with an educated government class.
 * The Black Sea and Anatolian interior remain deeply rural and subsistence-based.
 *
 * SEED INDEPENDENCE — all values independently authored from 1953 historical
 * knowledge; NOT scaled from any other era file.
 */

import type { TRRegionLayer1 } from "./trRegionCensusData";

export const trRegionCensusData1953: Record<string, TRRegionLayer1> = {
  TR_IST: {
    // Istanbul/Marmara: commerce, minorities, most educated and wealthiest region
    ethnicity: { turkish: 89, kurdish: 5, other: 6 },
    age: { young: 40, mid: 28, mature: 18, senior: 14 },
    education: { primary_or_below: 62, secondary: 24, vocational: 8, university: 6 },
    income: { low: 38, middle: 48, high: 14 },
    urbanization: { urban: 62, suburban: 16, rural: 22 },
  },
  TR_ANK: {
    // Ankara: planned capital; civil servants, military, modern educated class
    ethnicity: { turkish: 93, kurdish: 5, other: 2 },
    age: { young: 40, mid: 28, mature: 18, senior: 14 },
    education: { primary_or_below: 58, secondary: 26, vocational: 9, university: 7 },
    income: { low: 38, middle: 48, high: 14 },
    urbanization: { urban: 55, suburban: 18, rural: 27 },
  },
  TR_IZM: {
    // İzmir/Aegean: export agriculture (tobacco, figs, cotton); coastal commerce
    ethnicity: { turkish: 93, kurdish: 4, other: 3 },
    age: { young: 39, mid: 28, mature: 19, senior: 14 },
    education: { primary_or_below: 65, secondary: 24, vocational: 7, university: 4 },
    income: { low: 36, middle: 50, high: 14 },
    urbanization: { urban: 50, suburban: 14, rural: 36 },
  },
  TR_MED: {
    // Mediterranean: cotton and citrus; Adana as industrial hub; mixed ethnicity
    ethnicity: { turkish: 88, kurdish: 10, other: 2 },
    age: { young: 42, mid: 28, mature: 17, senior: 13 },
    education: { primary_or_below: 70, secondary: 20, vocational: 6, university: 4 },
    income: { low: 44, middle: 48, high: 8 },
    urbanization: { urban: 40, suburban: 12, rural: 48 },
  },
  TR_BLA: {
    // Black Sea: tea, hazelnuts, fishing; densely populated coastal strip, very rural
    ethnicity: { turkish: 96, kurdish: 2, other: 2 },
    age: { young: 42, mid: 28, mature: 18, senior: 12 },
    education: { primary_or_below: 72, secondary: 20, vocational: 5, university: 3 },
    income: { low: 46, middle: 46, high: 8 },
    urbanization: { urban: 28, suburban: 10, rural: 62 },
  },
  TR_ESA: {
    // Eastern Anatolia: underdeveloped; large Kurdish minority; near-subsistence farming
    ethnicity: { turkish: 58, kurdish: 40, other: 2 },
    age: { young: 46, mid: 28, mature: 16, senior: 10 },
    education: { primary_or_below: 78, secondary: 16, vocational: 4, university: 2 },
    income: { low: 62, middle: 34, high: 4 },
    urbanization: { urban: 24, suburban: 8, rural: 68 },
  },
  TR_SEA: {
    // SE Anatolia: Kurdish majority; tribal structures; poorest region in Turkey
    ethnicity: { turkish: 32, kurdish: 66, other: 2 },
    age: { young: 48, mid: 28, mature: 15, senior: 9 },
    education: { primary_or_below: 80, secondary: 14, vocational: 4, university: 2 },
    income: { low: 66, middle: 30, high: 4 },
    urbanization: { urban: 26, suburban: 8, rural: 66 },
  },
  TR_CEN: {
    // Central Anatolia: the Anatolian heartland; grain farming, Konya plain; rural conservative
    ethnicity: { turkish: 93, kurdish: 6, other: 1 },
    age: { young: 43, mid: 28, mature: 18, senior: 11 },
    education: { primary_or_below: 72, secondary: 20, vocational: 5, university: 3 },
    income: { low: 48, middle: 44, high: 8 },
    urbanization: { urban: 35, suburban: 10, rural: 55 },
  },
};

export default trRegionCensusData1953;
