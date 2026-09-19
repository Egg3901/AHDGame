/**
 * Japan Region Census Profiles — 1991 era.
 *
 * 1991-default companion to {@link jpRegionCensusData} (the 2019 profiles).
 * Selected at render time via the preset registry under the `1991-default`
 * reset preset.
 *
 * Sources / methodology (approximate, % of adult population): 1990 Population
 * Census of Japan. Bubble-era Japan was near-ethnically-homogeneous (the
 * zainichi Korean community, concentrated in Kansai, was the largest minority)
 * with a younger age structure and lower university advancement than today.
 * Income uses era-neutral relative tiers (no ¥ thresholds).
 *
 * Directional vs the 2019 profiles: higher `japanese` share, lower combined
 * `university` + `graduate` attainment.
 */

import type { JPRegionLayer1 } from "./jpRegionCensusData";

export const jpRegionCensusData1991: Record<string, JPRegionLayer1> = {
  // Hokkaido — rural north.
  HOK: {
    ethnicity: { japanese: 99, chinese: 0, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 19, mid: 24, mature: 33, senior: 24 },
    education: { high_school: 48, vocational: 22, university: 26, graduate: 4 },
    income: { low: 30, middle: 50, high: 20 },
    urbanization: { urban: 42, suburban: 26, rural: 32 },
  },
  // Tohoku — rural northeast.
  TOH: {
    ethnicity: { japanese: 99, chinese: 0, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 18, mid: 23, mature: 34, senior: 25 },
    education: { high_school: 52, vocational: 22, university: 22, graduate: 4 },
    income: { low: 33, middle: 50, high: 17 },
    urbanization: { urban: 28, suburban: 30, rural: 42 },
  },
  // Kanto — Tokyo metropolis, most urban + schooled.
  KAN: {
    ethnicity: { japanese: 97, chinese: 1, korean: 1, southeast_asian: 0, other_foreign: 1 },
    age: { young: 21, mid: 26, mature: 31, senior: 22 },
    education: { high_school: 40, vocational: 18, university: 35, graduate: 7 },
    income: { low: 22, middle: 50, high: 28 },
    urbanization: { urban: 82, suburban: 14, rural: 4 },
  },
  // Chubu — central Honshu (Nagoya).
  CHU: {
    ethnicity: { japanese: 98, chinese: 1, korean: 1, southeast_asian: 0, other_foreign: 0 },
    age: { young: 20, mid: 24, mature: 32, senior: 24 },
    education: { high_school: 47, vocational: 20, university: 28, graduate: 5 },
    income: { low: 25, middle: 53, high: 22 },
    urbanization: { urban: 55, suburban: 28, rural: 17 },
  },
  // Kansai — Osaka/Kyoto; largest zainichi Korean population.
  KNS: {
    ethnicity: { japanese: 97, chinese: 1, korean: 2, southeast_asian: 0, other_foreign: 0 },
    age: { young: 20, mid: 25, mature: 32, senior: 23 },
    education: { high_school: 44, vocational: 20, university: 31, graduate: 5 },
    income: { low: 24, middle: 52, high: 24 },
    urbanization: { urban: 72, suburban: 20, rural: 8 },
  },
  // Chugoku — western Honshu.
  CGK: {
    ethnicity: { japanese: 99, chinese: 0, korean: 1, southeast_asian: 0, other_foreign: 0 },
    age: { young: 19, mid: 23, mature: 33, senior: 25 },
    education: { high_school: 50, vocational: 21, university: 24, graduate: 5 },
    income: { low: 28, middle: 53, high: 19 },
    urbanization: { urban: 45, suburban: 28, rural: 27 },
  },
  // Shikoku — rural island.
  SHI: {
    ethnicity: { japanese: 99, chinese: 0, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 18, mid: 22, mature: 34, senior: 26 },
    education: { high_school: 52, vocational: 21, university: 23, graduate: 4 },
    income: { low: 31, middle: 52, high: 17 },
    urbanization: { urban: 35, suburban: 30, rural: 35 },
  },
  // Kyushu — southern island.
  KYU: {
    ethnicity: { japanese: 98, chinese: 1, korean: 1, southeast_asian: 0, other_foreign: 0 },
    age: { young: 20, mid: 23, mature: 32, senior: 25 },
    education: { high_school: 50, vocational: 21, university: 24, graduate: 5 },
    income: { low: 30, middle: 52, high: 18 },
    urbanization: { urban: 48, suburban: 28, rural: 24 },
  },
};
