/**
 * Japan Region Census Profiles — 2023 era.
 *
 * 2023-default companion to {@link jpRegionCensusData} (the 2019 profiles).
 *
 * Era anchor: 2020 Population Census of Japan plus 2023 Ministry of Internal
 * Affairs / Immigration Services Agency estimates (super-aged society). All
 * values independently authored from historical knowledge of each region
 * circa 2023 — NOT derived by scaling any other era's file.
 *
 * Character of the era: median age ~49; seniors are ~35–40% of adults in
 * rural regions; rural depopulation severe (Akita, Kochi shrinking >1%/yr);
 * Tokyo concentration extreme (net in-migration resumed post-COVID); foreign
 * residents ~2.5% nationally and rising fast — Vietnamese/other Southeast
 * Asian technical-intern workers now widespread including in rural areas,
 * Chinese the largest group in Tokyo. Income uses era-neutral relative tiers.
 */

import type { JPRegionLayer1 } from "./jpRegionCensusData";

export const jpRegionCensusData2023: Record<string, JPRegionLayer1> = {
  // Hokkaido — severe depopulation outside Sapporo; tourism/IT (Rapidus) bright spots.
  HOK: {
    ethnicity: { japanese: 97, chinese: 1, korean: 0, southeast_asian: 1, other_foreign: 1 },
    age: { young: 13, mid: 21, mature: 32, senior: 34 },
    education: { high_school: 34, vocational: 20, university: 39, graduate: 7 },
    income: { low: 33, middle: 47, high: 20 },
    urbanization: { urban: 46, suburban: 25, rural: 29 },
  },
  // Tohoku — Akita the oldest prefecture in Japan; post-3.11 recovery plateaued.
  TOH: {
    ethnicity: { japanese: 98, chinese: 0, korean: 0, southeast_asian: 1, other_foreign: 1 },
    age: { young: 11, mid: 19, mature: 32, senior: 38 },
    education: { high_school: 39, vocational: 22, university: 33, graduate: 6 },
    income: { low: 36, middle: 47, high: 17 },
    urbanization: { urban: 31, suburban: 30, rural: 39 },
  },
  // Kanto — Tokyo concentration extreme; most diverse and credentialed region.
  KAN: {
    ethnicity: { japanese: 95, chinese: 2, korean: 1, southeast_asian: 1, other_foreign: 1 },
    age: { young: 17, mid: 25, mature: 29, senior: 29 },
    education: { high_school: 24, vocational: 17, university: 46, graduate: 13 },
    income: { low: 22, middle: 45, high: 33 },
    urbanization: { urban: 69, suburban: 22, rural: 9 },
  },
  // Chubu — auto belt now reliant on Vietnamese/Filipino technical interns.
  CHU: {
    ethnicity: { japanese: 95, chinese: 1, korean: 0, southeast_asian: 3, other_foreign: 1 },
    age: { young: 13, mid: 22, mature: 31, senior: 34 },
    education: { high_school: 31, vocational: 21, university: 39, graduate: 9 },
    income: { low: 25, middle: 49, high: 26 },
    urbanization: { urban: 46, suburban: 30, rural: 24 },
  },
  // Kansai — inbound-tourism rebound; Expo 2025 buildout; aging zainichi community.
  KNS: {
    ethnicity: { japanese: 95, chinese: 2, korean: 2, southeast_asian: 0, other_foreign: 1 },
    age: { young: 15, mid: 23, mature: 30, senior: 32 },
    education: { high_school: 27, vocational: 20, university: 43, graduate: 10 },
    income: { low: 27, middle: 47, high: 26 },
    urbanization: { urban: 61, suburban: 24, rural: 15 },
  },
  // Chugoku — Sanin coast among Japan's emptiest; Hiroshima/Okayama hold steady.
  CGK: {
    ethnicity: { japanese: 97, chinese: 1, korean: 0, southeast_asian: 1, other_foreign: 1 },
    age: { young: 11, mid: 19, mature: 32, senior: 38 },
    education: { high_school: 37, vocational: 22, university: 35, graduate: 6 },
    income: { low: 31, middle: 49, high: 20 },
    urbanization: { urban: 36, suburban: 30, rural: 34 },
  },
  // Shikoku — oldest, most rural region; Kochi seniors ~40% of adults.
  SHI: {
    ethnicity: { japanese: 98, chinese: 0, korean: 0, southeast_asian: 1, other_foreign: 1 },
    age: { young: 10, mid: 18, mature: 32, senior: 40 },
    education: { high_school: 41, vocational: 23, university: 31, graduate: 5 },
    income: { low: 34, middle: 49, high: 17 },
    urbanization: { urban: 28, suburban: 30, rural: 42 },
  },
  // Kyushu — TSMC Kumamoto boom; Fukuoka the fastest-growing big city outside Tokyo.
  KYU: {
    ethnicity: { japanese: 97, chinese: 1, korean: 1, southeast_asian: 0, other_foreign: 1 },
    age: { young: 13, mid: 21, mature: 31, senior: 35 },
    education: { high_school: 35, vocational: 22, university: 36, graduate: 7 },
    income: { low: 31, middle: 49, high: 20 },
    urbanization: { urban: 41, suburban: 28, rural: 31 },
  },
};
