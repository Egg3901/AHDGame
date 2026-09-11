/**
 * Japan Region Census Profiles - 2027 era.
 *
 * 2027-default companion to {@link jpRegionCensusData2023}. Every value is
 * independently authored for 2027 as a literal, using the 2023 bundle as the
 * visible base plus the documented projection assumptions below. This file
 * does not import or scale any other era file.
 *
 * Base: 2023 bundle (2020 census read forward, super-aged society).
 * Projection assumptions 2023 to 2027:
 * - Senior share rises 1 to 2 points in every region (national 2025 census
 *   preliminary: record aging, only Tokyo and Okinawa growing).
 *   Young and mid shares fall to compensate.
 * - Foreign-resident share rises about 1 point nearly everywhere
 *   (nationwide foreign population up by roughly 0.3 million per year
 *   through 2025; Vietnamese and other Southeast Asian technical-intern
 *   workers spread further into Chubu, Kyushu, and rural regions).
 * - University share rises 1 point as higher-ed massification continues;
 *   high school or vocational falls to compensate.
 * - Urban share rises 1 point (Tokyo concentration plus Fukuoka growth);
 *   rural falls to compensate.
 *
 * Sources:
 * https://www.stat.go.jp/english/data/jinsui/ (population estimates)
 * https://www.stat.go.jp/data/kokusei/2025/index.html (2025 census portal)
 */
import type { JPRegionLayer1 } from "./jpRegionCensusData";

export const jpRegionCensusData2027: Record<string, JPRegionLayer1> = {
  // Hokkaido - Sapporo holds while the interior keeps shrinking; seniors 36.
  HOK: {
    ethnicity: { japanese: 96, chinese: 1, korean: 0, southeast_asian: 2, other_foreign: 1 },
    age: { young: 12, mid: 20, mature: 32, senior: 36 },
    education: { high_school: 33, vocational: 19, university: 40, graduate: 8 },
    income: { low: 34, middle: 46, high: 20 },
    urbanization: { urban: 47, suburban: 25, rural: 28 },
  },
  // Tohoku - fastest-shrinking mainland region; seniors reach 40.
  TOH: {
    ethnicity: { japanese: 97, chinese: 0, korean: 0, southeast_asian: 2, other_foreign: 1 },
    age: { young: 10, mid: 18, mature: 32, senior: 40 },
    education: { high_school: 38, vocational: 22, university: 34, graduate: 6 },
    income: { low: 37, middle: 46, high: 17 },
    urbanization: { urban: 32, suburban: 30, rural: 38 },
  },
  // Kanto - Tokyo in-migration plus foreign inflow hold population flat;
  // most diverse and credentialed region by a wide margin.
  KAN: {
    ethnicity: { japanese: 94, chinese: 2, korean: 1, southeast_asian: 2, other_foreign: 1 },
    age: { young: 16, mid: 25, mature: 29, senior: 30 },
    education: { high_school: 23, vocational: 17, university: 47, graduate: 13 },
    income: { low: 22, middle: 45, high: 33 },
    urbanization: { urban: 70, suburban: 21, rural: 9 },
  },
  // Chubu - auto-belt interns keep the foreign share highest nationally.
  CHU: {
    ethnicity: { japanese: 94, chinese: 1, korean: 0, southeast_asian: 4, other_foreign: 1 },
    age: { young: 12, mid: 21, mature: 31, senior: 36 },
    education: { high_school: 30, vocational: 21, university: 40, graduate: 9 },
    income: { low: 26, middle: 48, high: 26 },
    urbanization: { urban: 47, suburban: 30, rural: 23 },
  },
  // Kansai - Expo 2025 legacy plus inbound tourism; seniors 34.
  KNS: {
    ethnicity: { japanese: 94, chinese: 2, korean: 2, southeast_asian: 1, other_foreign: 1 },
    age: { young: 14, mid: 22, mature: 30, senior: 34 },
    education: { high_school: 26, vocational: 20, university: 44, graduate: 10 },
    income: { low: 28, middle: 46, high: 26 },
    urbanization: { urban: 62, suburban: 24, rural: 14 },
  },
  // Chugoku - Sanin coast keeps emptying; Hiroshima/Okayama hold steady.
  CGK: {
    ethnicity: { japanese: 96, chinese: 1, korean: 0, southeast_asian: 2, other_foreign: 1 },
    age: { young: 10, mid: 18, mature: 32, senior: 40 },
    education: { high_school: 36, vocational: 22, university: 36, graduate: 6 },
    income: { low: 32, middle: 48, high: 20 },
    urbanization: { urban: 37, suburban: 30, rural: 33 },
  },
  // Shikoku - oldest region; seniors 42, rural share still above 40.
  SHI: {
    ethnicity: { japanese: 97, chinese: 0, korean: 0, southeast_asian: 2, other_foreign: 1 },
    age: { young: 9, mid: 17, mature: 32, senior: 42 },
    education: { high_school: 40, vocational: 23, university: 32, graduate: 5 },
    income: { low: 35, middle: 48, high: 17 },
    urbanization: { urban: 29, suburban: 30, rural: 41 },
  },
  // Kyushu - TSMC Kumamoto plus Fukuoka growth slow the decline; Okinawa
  // (in this game region) is one of two prefectures still growing.
  KYU: {
    ethnicity: { japanese: 96, chinese: 1, korean: 1, southeast_asian: 1, other_foreign: 1 },
    age: { young: 12, mid: 20, mature: 31, senior: 37 },
    education: { high_school: 34, vocational: 22, university: 37, graduate: 7 },
    income: { low: 32, middle: 48, high: 20 },
    urbanization: { urban: 42, suburban: 28, rural: 30 },
  },
};

export default jpRegionCensusData2027;
