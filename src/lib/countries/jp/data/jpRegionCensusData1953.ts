/**
 * Japan Region Census Profiles — 1953 era.
 *
 * 1953-default companion to {@link jpRegionCensusData} (the 2019 profiles).
 * Anchored on 1950 Population Census of Japan and 1955 follow-up.
 *
 * Era anchors (post-occupation / Korean War boom tail): the Allied occupation
 * ended April 1952; GDP was roughly 1/5 of 1979 in real terms; the rural-to-
 * urban migration that would build the 1960s miracle had barely begun —
 * 61% of the population was still in agriculture in 1950; university
 * advancement was ~5-8% nationally, heavily concentrated in Tokyo and Osaka;
 * the baby boom of 1947–49 (dankai no sedai) had produced a very young
 * population but those cohorts are under 10 and not yet in the adult pool;
 * the adult age structure is therefore older than 1979 (WWII killed 2-3 million
 * young men aged 18-35, leaving an older skew). The zainichi Korean community
 * existed but was smaller than 1979's. All income tiers era-neutral (no
 * yen thresholds).
 */

import type { JPRegionLayer1 } from "./jpRegionCensusData";

export const jpRegionCensusData1953: Record<string, JPRegionLayer1> = {
  // Hokkaido — coal/agriculture; Sapporo still small; pioneer settlers.
  HOK: {
    ethnicity: { japanese: 99, chinese: 0, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 20, mid: 26, mature: 34, senior: 20 },
    education: {
      primary_or_below: 20,
      high_school: 55,
      vocational: 18,
      university: 6,
      graduate: 1,
    },
    income: { low: 48, middle: 44, high: 8 },
    urbanization: { urban: 28, suburban: 22, rural: 50 },
  },
  // Tohoku — deeply rural; out-migration just beginning.
  TOH: {
    ethnicity: { japanese: 99, chinese: 0, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 19, mid: 25, mature: 34, senior: 22 },
    education: {
      primary_or_below: 20,
      high_school: 60,
      vocational: 15,
      university: 4,
      graduate: 1,
    },
    income: { low: 56, middle: 38, high: 6 },
    urbanization: { urban: 14, suburban: 22, rural: 64 },
  },
  // Kanto — Tokyo-Yokohama rebuilding rapidly; US troops spending boosts urban economy.
  KAN: {
    ethnicity: { japanese: 99, chinese: 0, korean: 1, southeast_asian: 0, other_foreign: 0 },
    age: { young: 22, mid: 27, mature: 32, senior: 19 },
    education: {
      primary_or_below: 22,
      high_school: 46,
      vocational: 15,
      university: 14,
      graduate: 3,
    },
    income: { low: 32, middle: 52, high: 16 },
    urbanization: { urban: 60, suburban: 18, rural: 22 },
  },
  // Chubu — Nagoya/Tokai industries beginning post-war restart; still rural majority.
  CHU: {
    ethnicity: { japanese: 99, chinese: 0, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 21, mid: 25, mature: 33, senior: 21 },
    education: {
      primary_or_below: 22,
      high_school: 54,
      vocational: 16,
      university: 7,
      graduate: 1,
    },
    income: { low: 42, middle: 48, high: 10 },
    urbanization: { urban: 35, suburban: 25, rural: 40 },
  },
  // Kansai — Osaka/Kobe commerce rebuilding; largest zainichi Korean community.
  KNS: {
    ethnicity: { japanese: 97, chinese: 0, korean: 3, southeast_asian: 0, other_foreign: 0 },
    age: { young: 21, mid: 26, mature: 33, senior: 20 },
    education: {
      primary_or_below: 21,
      high_school: 50,
      vocational: 16,
      university: 11,
      graduate: 2,
    },
    income: { low: 38, middle: 50, high: 12 },
    urbanization: { urban: 52, suburban: 22, rural: 26 },
  },
  // Chugoku — Hiroshima (devastated 1945, slowly rebuilding); Mizushima not yet.
  CGK: {
    ethnicity: { japanese: 99, chinese: 0, korean: 1, southeast_asian: 0, other_foreign: 0 },
    age: { young: 19, mid: 24, mature: 35, senior: 22 },
    education: {
      primary_or_below: 21,
      high_school: 56,
      vocational: 16,
      university: 6,
      graduate: 1,
    },
    income: { low: 46, middle: 46, high: 8 },
    urbanization: { urban: 28, suburban: 26, rural: 46 },
  },
  // Shikoku — agricultural/fishing; already among the older regions.
  SHI: {
    ethnicity: { japanese: 99, chinese: 0, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 18, mid: 23, mature: 36, senior: 23 },
    education: {
      primary_or_below: 20,
      high_school: 59,
      vocational: 15,
      university: 5,
      graduate: 1,
    },
    income: { low: 52, middle: 42, high: 6 },
    urbanization: { urban: 18, suburban: 26, rural: 56 },
  },
  // Kyushu — post-coal (Chikuho still open); large US base presence (Korea War).
  KYU: {
    ethnicity: { japanese: 99, chinese: 0, korean: 1, southeast_asian: 0, other_foreign: 0 },
    age: { young: 20, mid: 24, mature: 34, senior: 22 },
    education: {
      primary_or_below: 21,
      high_school: 57,
      vocational: 15,
      university: 6,
      graduate: 1,
    },
    income: { low: 50, middle: 43, high: 7 },
    urbanization: { urban: 28, suburban: 26, rural: 46 },
  },
};
