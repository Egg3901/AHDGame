/**
 * Japan Region Census Profiles — 1979 era.
 *
 * 1979-default companion to {@link jpRegionCensusData} (the 2019 profiles).
 *
 * Era anchor: 1980 Population Census of Japan (high-growth tail). All values
 * independently authored from historical knowledge of each region circa 1979 —
 * NOT derived by scaling any other era's file.
 *
 * Character of the era: very young adult population (baby boomers in their
 * 20s–30s), seniors under 20% everywhere, near-zero foreign residents (the
 * zainichi Korean community in Kansai/Kyushu was the only sizable minority),
 * high-school-dominant education (university advancement ~25–35% only in the
 * metropolises), rural prefectures still populous, manufacturing belt
 * (Chubu/Kansai) booming. Income uses era-neutral relative tiers.
 */

import type { JPRegionLayer1 } from "./jpRegionCensusData";

export const jpRegionCensusData1979: Record<string, JPRegionLayer1> = {
  // Hokkaido — coal/agriculture economy still alive; Sapporo growing post-Olympics.
  HOK: {
    ethnicity: { japanese: 99, chinese: 0, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 24, mid: 27, mature: 32, senior: 17 },
    education: { high_school: 58, vocational: 18, university: 21, graduate: 3 },
    income: { low: 32, middle: 52, high: 16 },
    urbanization: { urban: 38, suburban: 26, rural: 36 },
  },
  // Tohoku — deeply rural; out-migration of youth to Tokyo, but villages still full.
  TOH: {
    ethnicity: { japanese: 99, chinese: 0, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 23, mid: 26, mature: 33, senior: 18 },
    education: { high_school: 64, vocational: 16, university: 17, graduate: 3 },
    income: { low: 36, middle: 50, high: 14 },
    urbanization: { urban: 24, suburban: 28, rural: 48 },
  },
  // Kanto — Tokyo megalopolis absorbing the youth of the nation.
  KAN: {
    ethnicity: { japanese: 98, chinese: 0, korean: 1, southeast_asian: 0, other_foreign: 1 },
    age: { young: 26, mid: 29, mature: 30, senior: 15 },
    education: { high_school: 48, vocational: 16, university: 29, graduate: 7 },
    income: { low: 22, middle: 52, high: 26 },
    urbanization: { urban: 78, suburban: 16, rural: 6 },
  },
  // Chubu — Toyota-era manufacturing boom around Nagoya.
  CHU: {
    ethnicity: { japanese: 99, chinese: 0, korean: 1, southeast_asian: 0, other_foreign: 0 },
    age: { young: 25, mid: 27, mature: 31, senior: 17 },
    education: { high_school: 56, vocational: 17, university: 23, graduate: 4 },
    income: { low: 26, middle: 54, high: 20 },
    urbanization: { urban: 50, suburban: 28, rural: 22 },
  },
  // Kansai — Osaka still Japan's commercial second pole; largest zainichi community.
  KNS: {
    ethnicity: { japanese: 97, chinese: 0, korean: 2, southeast_asian: 0, other_foreign: 1 },
    age: { young: 25, mid: 28, mature: 31, senior: 16 },
    education: { high_school: 52, vocational: 17, university: 26, graduate: 5 },
    income: { low: 25, middle: 53, high: 22 },
    urbanization: { urban: 68, suburban: 22, rural: 10 },
  },
  // Chugoku — heavy industry (Mizushima, Fukuyama steel) plus rural Sanin coast.
  CGK: {
    ethnicity: { japanese: 99, chinese: 0, korean: 1, southeast_asian: 0, other_foreign: 0 },
    age: { young: 23, mid: 26, mature: 33, senior: 18 },
    education: { high_school: 58, vocational: 17, university: 21, graduate: 4 },
    income: { low: 30, middle: 52, high: 18 },
    urbanization: { urban: 40, suburban: 28, rural: 32 },
  },
  // Shikoku — agricultural/fishing island; already the oldest region.
  SHI: {
    ethnicity: { japanese: 99, chinese: 0, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 22, mid: 25, mature: 34, senior: 19 },
    education: { high_school: 62, vocational: 16, university: 19, graduate: 3 },
    income: { low: 34, middle: 52, high: 14 },
    urbanization: { urban: 30, suburban: 30, rural: 40 },
  },
  // Kyushu — post-coal transition (Chikuho closures); Fukuoka emerging hub.
  KYU: {
    ethnicity: { japanese: 98, chinese: 0, korean: 1, southeast_asian: 0, other_foreign: 1 },
    age: { young: 24, mid: 26, mature: 32, senior: 18 },
    education: { high_school: 60, vocational: 16, university: 20, graduate: 4 },
    income: { low: 33, middle: 51, high: 16 },
    urbanization: { urban: 42, suburban: 28, rural: 30 },
  },
};
