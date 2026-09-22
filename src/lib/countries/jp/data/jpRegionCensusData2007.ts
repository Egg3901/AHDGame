/**
 * Japan Region Census Profiles — 2007 era.
 *
 * 2007-default companion to {@link jpRegionCensusData} (the 2019 profiles).
 *
 * Era anchor: 2005 Population Census of Japan plus 2007 Ministry of Internal
 * Affairs population estimates (Koizumi-reform aftermath). All values
 * independently authored from historical knowledge of each region circa 2007 —
 * NOT derived by scaling any other era's file.
 *
 * Character of the era: national population peaked (2008); seniors near 30%
 * of adults in rural regions; Tokyo concentration accelerating after the
 * reform years while regional cities hollow out ("shutter streets"); foreign
 * residents ~1.7% nationally (Chinese now the largest group, Brazilians in
 * Chubu, Filipinos/Southeast Asians appearing); university advancement past
 * 50% of new cohorts. Income uses era-neutral relative tiers.
 */

import type { JPRegionLayer1 } from "./jpRegionCensusData";

export const jpRegionCensusData2007: Record<string, JPRegionLayer1> = {
  // Hokkaido — Yubari municipal bankruptcy (2007) emblematic of regional decline.
  HOK: {
    ethnicity: { japanese: 98, chinese: 1, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 15, mid: 23, mature: 34, senior: 28 },
    education: { high_school: 39, vocational: 21, university: 34, graduate: 6 },
    income: { low: 33, middle: 48, high: 19 },
    urbanization: { urban: 45, suburban: 25, rural: 30 },
  },
  // Tohoku — public-works cuts under Koizumi bit hard; aging deepening.
  TOH: {
    ethnicity: { japanese: 99, chinese: 0, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 13, mid: 21, mature: 35, senior: 31 },
    education: { high_school: 44, vocational: 22, university: 29, graduate: 5 },
    income: { low: 35, middle: 49, high: 16 },
    urbanization: { urban: 29, suburban: 30, rural: 41 },
  },
  // Kanto — Tokyo boom years (Roppongi Hills era); net in-migration strong.
  KAN: {
    ethnicity: { japanese: 96, chinese: 1, korean: 1, southeast_asian: 1, other_foreign: 1 },
    age: { young: 18, mid: 26, mature: 31, senior: 25 },
    education: { high_school: 29, vocational: 19, university: 42, graduate: 10 },
    income: { low: 22, middle: 47, high: 31 },
    urbanization: { urban: 70, suburban: 21, rural: 9 },
  },
  // Chubu — export boom peak ("Toyota shock" still a year away); Brazilian workers at maximum.
  CHU: {
    ethnicity: { japanese: 96, chinese: 1, korean: 1, southeast_asian: 1, other_foreign: 1 },
    age: { young: 15, mid: 24, mature: 33, senior: 28 },
    education: { high_school: 37, vocational: 21, university: 35, graduate: 7 },
    income: { low: 25, middle: 51, high: 24 },
    urbanization: { urban: 47, suburban: 30, rural: 23 },
  },
  // Kansai — continued relative decline vs Tokyo; zainichi community aging.
  KNS: {
    ethnicity: { japanese: 96, chinese: 1, korean: 2, southeast_asian: 0, other_foreign: 1 },
    age: { young: 17, mid: 24, mature: 32, senior: 27 },
    education: { high_school: 33, vocational: 20, university: 38, graduate: 9 },
    income: { low: 26, middle: 49, high: 25 },
    urbanization: { urban: 62, suburban: 24, rural: 14 },
  },
  // Chugoku — Sanyo industry steady, Sanin coast among Japan's oldest areas.
  CGK: {
    ethnicity: { japanese: 98, chinese: 1, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 13, mid: 21, mature: 35, senior: 31 },
    education: { high_school: 41, vocational: 22, university: 31, graduate: 6 },
    income: { low: 30, middle: 50, high: 20 },
    urbanization: { urban: 37, suburban: 30, rural: 33 },
  },
  // Shikoku — fastest-aging region; merger wave (heisei gappei) consolidating towns.
  SHI: {
    ethnicity: { japanese: 99, chinese: 0, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 12, mid: 20, mature: 35, senior: 33 },
    education: { high_school: 45, vocational: 23, university: 28, graduate: 4 },
    income: { low: 33, middle: 50, high: 17 },
    urbanization: { urban: 30, suburban: 30, rural: 40 },
  },
  // Kyushu — Fukuoka thriving; semiconductor "Silicon Island" plants in Kumamoto/Oita.
  KYU: {
    ethnicity: { japanese: 98, chinese: 0, korean: 1, southeast_asian: 0, other_foreign: 1 },
    age: { young: 14, mid: 22, mature: 34, senior: 30 },
    education: { high_school: 40, vocational: 22, university: 32, graduate: 6 },
    income: { low: 31, middle: 49, high: 20 },
    urbanization: { urban: 42, suburban: 28, rural: 30 },
  },
};
