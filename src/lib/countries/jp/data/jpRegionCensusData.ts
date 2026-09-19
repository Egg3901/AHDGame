/**
 * JP Region Census Profiles — Layer 1 demographic breakdown per region.
 *
 * Mirrors the UK `ukRegionCensusData` structure, adapted for Japanese census
 * categories from the 2020 National Census.
 *
 * Fields:
 *   ethnicity     — Japanese nationality breakdown (97%+ Japanese, small foreign resident %)
 *   age           — Distribution of adult (18+) population
 *   education     — Highest education level attained
 *   income        — Household income bands (approximate, in JPY)
 *   urbanization  — Urban / suburban / rural split
 */

export interface JPRegionLayer1 {
  ethnicity: {
    japanese: number;
    chinese: number;
    korean: number;
    southeast_asian: number;
    other_foreign: number;
  };
  age: {
    young: number; // 18–29
    mid: number; // 30–44
    mature: number; // 45–64
    senior: number; // 65+
  };
  education: {
    primary_or_below?: number; // Compulsory schooling only (older eras only)
    high_school: number; // High school diploma
    vocational: number; // Senmon-gakko (vocational college)
    university: number; // University degree
    graduate: number; // Graduate degree
  };
  income: {
    low: number; // Below ¥3M household
    middle: number; // ¥3-7M household
    high: number; // Above ¥7M household
  };
  urbanization: {
    urban: number; // Major city / ward
    suburban: number; // Smaller city / town
    rural: number; // Village / countryside
  };
}

/**
 * Census data for each JP game region.
 * Sources: 2020 Japan National Census, Ministry of Internal Affairs statistics,
 * Ministry of Justice foreign resident statistics.
 */
export const jpRegionCensusData: Record<string, JPRegionLayer1> = {
  HOK: {
    ethnicity: { japanese: 98, chinese: 1, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 14, mid: 22, mature: 32, senior: 32 },
    education: { high_school: 35, vocational: 20, university: 38, graduate: 7 },
    income: { low: 32, middle: 48, high: 20 },
    urbanization: { urban: 45, suburban: 25, rural: 30 },
  },
  TOH: {
    ethnicity: { japanese: 99, chinese: 0, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 12, mid: 20, mature: 33, senior: 35 },
    education: { high_school: 40, vocational: 22, university: 32, graduate: 6 },
    income: { low: 35, middle: 48, high: 17 },
    urbanization: { urban: 30, suburban: 30, rural: 40 },
  },
  KAN: {
    ethnicity: { japanese: 96, chinese: 1, korean: 1, southeast_asian: 1, other_foreign: 1 },
    age: { young: 17, mid: 25, mature: 30, senior: 28 },
    education: { high_school: 25, vocational: 18, university: 45, graduate: 12 },
    income: { low: 22, middle: 46, high: 32 },
    urbanization: { urban: 68, suburban: 22, rural: 10 },
  },
  CHU: {
    ethnicity: { japanese: 96, chinese: 1, korean: 0, southeast_asian: 2, other_foreign: 1 },
    age: { young: 14, mid: 23, mature: 32, senior: 31 },
    education: { high_school: 32, vocational: 22, university: 38, graduate: 8 },
    income: { low: 25, middle: 50, high: 25 },
    urbanization: { urban: 45, suburban: 30, rural: 25 },
  },
  KNS: {
    ethnicity: { japanese: 96, chinese: 1, korean: 2, southeast_asian: 0, other_foreign: 1 },
    age: { young: 17, mid: 24, mature: 31, senior: 28 },
    education: { high_school: 26, vocational: 19, university: 44, graduate: 11 },
    income: { low: 25, middle: 48, high: 27 },
    urbanization: { urban: 66, suburban: 22, rural: 12 },
  },
  CGK: {
    ethnicity: { japanese: 98, chinese: 1, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 12, mid: 20, mature: 33, senior: 35 },
    education: { high_school: 38, vocational: 22, university: 34, graduate: 6 },
    income: { low: 30, middle: 50, high: 20 },
    urbanization: { urban: 35, suburban: 30, rural: 35 },
  },
  SHI: {
    ethnicity: { japanese: 99, chinese: 0, korean: 0, southeast_asian: 0, other_foreign: 1 },
    age: { young: 11, mid: 19, mature: 33, senior: 37 },
    education: { high_school: 42, vocational: 23, university: 30, graduate: 5 },
    income: { low: 33, middle: 50, high: 17 },
    urbanization: { urban: 28, suburban: 30, rural: 42 },
  },
  KYU: {
    ethnicity: { japanese: 98, chinese: 0, korean: 1, southeast_asian: 0, other_foreign: 1 },
    age: { young: 14, mid: 22, mature: 32, senior: 32 },
    education: { high_school: 36, vocational: 22, university: 35, graduate: 7 },
    income: { low: 30, middle: 50, high: 20 },
    urbanization: { urban: 40, suburban: 28, rural: 32 },
  },
};
