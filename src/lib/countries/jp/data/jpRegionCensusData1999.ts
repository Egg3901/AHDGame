/**
 * Japan Region Census Profiles — 1999 era.
 *
 * 1999-default companion to {@link jpRegionCensusData} (the 2019 profiles).
 *
 * Era anchor: 2000 Population Census of Japan (lost decade). All values
 * independently authored from historical knowledge of each region circa 1999 —
 * NOT derived by scaling any other era's file.
 *
 * Character of the era: post-bubble stagnation, the youth "employment ice
 * age", aging accelerating (seniors in the mid-20s% of adults in rural
 * regions), foreign residents beginning to rise (Chinese students/workers in
 * Tokyo, Nikkei Brazilians in the Chubu factory belt counted under
 * other_foreign), university advancement climbing past 35% nationally.
 * Income uses era-neutral relative tiers.
 */

import type { JPRegionLayer1 } from "./jpRegionCensusData";

export const jpRegionCensusData1999: Record<string, JPRegionLayer1> = {
  // Hokkaido — Takushoku Bank collapse (1997) hit the regional economy hard.
  HOK: {
    ethnicity: { japanese: 99, chinese: 0, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 16, mid: 24, mature: 35, senior: 25 },
    education: { high_school: 44, vocational: 22, university: 30, graduate: 4 },
    income: { low: 32, middle: 50, high: 18 },
    urbanization: { urban: 44, suburban: 25, rural: 31 },
  },
  // Tohoku — public-works dependent; youth drain to Tokyo continuing.
  TOH: {
    ethnicity: { japanese: 99, chinese: 0, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 15, mid: 22, mature: 36, senior: 27 },
    education: { high_school: 48, vocational: 22, university: 26, graduate: 4 },
    income: { low: 35, middle: 49, high: 16 },
    urbanization: { urban: 28, suburban: 30, rural: 42 },
  },
  // Kanto — Tokyo re-concentration begins even amid stagnation.
  KAN: {
    ethnicity: { japanese: 97, chinese: 1, korean: 1, southeast_asian: 0, other_foreign: 1 },
    age: { young: 19, mid: 26, mature: 33, senior: 22 },
    education: { high_school: 34, vocational: 19, university: 39, graduate: 8 },
    income: { low: 23, middle: 49, high: 28 },
    urbanization: { urban: 76, suburban: 17, rural: 7 },
  },
  // Chubu — auto exports cushion the slump; Brazilian Nikkei factory workers.
  CHU: {
    ethnicity: { japanese: 97, chinese: 1, korean: 1, southeast_asian: 0, other_foreign: 1 },
    age: { young: 17, mid: 24, mature: 34, senior: 25 },
    education: { high_school: 42, vocational: 21, university: 31, graduate: 6 },
    income: { low: 25, middle: 52, high: 23 },
    urbanization: { urban: 50, suburban: 29, rural: 21 },
  },
  // Kansai — Osaka's relative decline; post-Hanshin-quake recovery.
  KNS: {
    ethnicity: { japanese: 97, chinese: 1, korean: 2, southeast_asian: 0, other_foreign: 0 },
    age: { young: 18, mid: 25, mature: 33, senior: 24 },
    education: { high_school: 38, vocational: 20, university: 35, graduate: 7 },
    income: { low: 26, middle: 50, high: 24 },
    urbanization: { urban: 66, suburban: 23, rural: 11 },
  },
  // Chugoku — industrial coast stagnant, Sanin side aging fast.
  CGK: {
    ethnicity: { japanese: 98, chinese: 0, korean: 1, southeast_asian: 0, other_foreign: 1 },
    age: { young: 15, mid: 22, mature: 36, senior: 27 },
    education: { high_school: 45, vocational: 22, university: 28, graduate: 5 },
    income: { low: 30, middle: 51, high: 19 },
    urbanization: { urban: 40, suburban: 29, rural: 31 },
  },
  // Shikoku — oldest region; bridges opened but depopulation continues.
  SHI: {
    ethnicity: { japanese: 99, chinese: 0, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 14, mid: 21, mature: 36, senior: 29 },
    education: { high_school: 48, vocational: 22, university: 26, graduate: 4 },
    income: { low: 33, middle: 50, high: 17 },
    urbanization: { urban: 32, suburban: 30, rural: 38 },
  },
  // Kyushu — Fukuoka growing as regional capital while periphery shrinks.
  KYU: {
    ethnicity: { japanese: 98, chinese: 0, korean: 1, southeast_asian: 0, other_foreign: 1 },
    age: { young: 16, mid: 23, mature: 34, senior: 27 },
    education: { high_school: 45, vocational: 21, university: 29, graduate: 5 },
    income: { low: 31, middle: 50, high: 19 },
    urbanization: { urban: 44, suburban: 28, rural: 28 },
  },
};
