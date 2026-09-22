/**
 * USSR Region Census Profiles — Layer 1 demographic breakdown per region (1979).
 * Mirrors the structure of the CN/UK/JP census files; the USSR only exists in
 * the 1979 preset, so there is a single era table.
 *
 * SEED INDEPENDENCE — authored for ~1979 directly (1979 Soviet census).
 *
 * Ethnicity uses the broad Soviet nationality groupings used in the region model
 * (Russian, Ukrainian, Central-Asian, Caucasian, and an aggregated `other`
 * covering Tatar/Bashkir/Baltic-adjacent/Moldovan/Siberian peoples). Belarus and
 * the Baltics are separate countries and not represented here.
 *
 * Fields (% of adult population, each dimension sums to 100):
 *   ethnicity    — Soviet nationality groupings
 *   age          — adult (18+) distribution
 *   education    — highest level completed (USSR had near-universal secondary)
 *   income       — relative household tiers (compressed planned economy)
 *   urbanization — urban / suburban / rural split
 */

export interface SURegionLayer1 {
  ethnicity: {
    russian: number;
    ukrainian: number;
    central_asian: number;
    caucasian: number;
    other: number;
  };
  age: { young: number; mid: number; mature: number; senior: number };
  education: {
    primary_or_below: number;
    secondary: number;
    vocational: number;
    university: number;
  };
  income: { low: number; middle: number; high: number };
  urbanization: { urban: number; suburban: number; rural: number };
}

export const ruRegionCensusData: Record<string, SURegionLayer1> = {
  // ── RSFSR (Russia) macro-regions ───────────────────────────────────────────
  CEN: {
    ethnicity: { russian: 95, ukrainian: 1, central_asian: 0, caucasian: 0, other: 4 },
    age: { young: 30, mid: 28, mature: 24, senior: 18 },
    education: { primary_or_below: 20, secondary: 50, vocational: 18, university: 12 },
    income: { low: 18, middle: 60, high: 22 },
    urbanization: { urban: 78, suburban: 10, rural: 12 },
  },
  NWR: {
    ethnicity: { russian: 92, ukrainian: 2, central_asian: 0, caucasian: 0, other: 6 },
    age: { young: 30, mid: 28, mature: 24, senior: 18 },
    education: { primary_or_below: 20, secondary: 50, vocational: 18, university: 12 },
    income: { low: 20, middle: 60, high: 20 },
    urbanization: { urban: 80, suburban: 8, rural: 12 },
  },
  NOR: {
    ethnicity: { russian: 90, ukrainian: 1, central_asian: 0, caucasian: 0, other: 9 },
    age: { young: 31, mid: 28, mature: 23, senior: 18 },
    education: { primary_or_below: 24, secondary: 50, vocational: 16, university: 10 },
    income: { low: 24, middle: 60, high: 16 },
    urbanization: { urban: 70, suburban: 10, rural: 20 },
  },
  CBE: {
    ethnicity: { russian: 95, ukrainian: 3, central_asian: 0, caucasian: 0, other: 2 },
    age: { young: 29, mid: 27, mature: 24, senior: 20 },
    education: { primary_or_below: 28, secondary: 50, vocational: 14, university: 8 },
    income: { low: 28, middle: 58, high: 14 },
    urbanization: { urban: 58, suburban: 12, rural: 30 },
  },
  VOL: {
    ethnicity: { russian: 75, ukrainian: 1, central_asian: 0, caucasian: 0, other: 24 },
    age: { young: 31, mid: 28, mature: 23, senior: 18 },
    education: { primary_or_below: 26, secondary: 50, vocational: 15, university: 9 },
    income: { low: 26, middle: 60, high: 14 },
    urbanization: { urban: 68, suburban: 10, rural: 22 },
  },
  NCA: {
    ethnicity: { russian: 65, ukrainian: 2, central_asian: 0, caucasian: 28, other: 5 },
    age: { young: 33, mid: 28, mature: 22, senior: 17 },
    education: { primary_or_below: 30, secondary: 48, vocational: 14, university: 8 },
    income: { low: 30, middle: 58, high: 12 },
    urbanization: { urban: 55, suburban: 12, rural: 33 },
  },
  URA: {
    ethnicity: { russian: 82, ukrainian: 1, central_asian: 0, caucasian: 0, other: 17 },
    age: { young: 31, mid: 28, mature: 23, senior: 18 },
    education: { primary_or_below: 24, secondary: 52, vocational: 16, university: 8 },
    income: { low: 24, middle: 62, high: 14 },
    urbanization: { urban: 74, suburban: 10, rural: 16 },
  },
  WSB: {
    ethnicity: { russian: 88, ukrainian: 2, central_asian: 0, caucasian: 0, other: 10 },
    age: { young: 32, mid: 28, mature: 23, senior: 17 },
    education: { primary_or_below: 24, secondary: 52, vocational: 16, university: 8 },
    income: { low: 24, middle: 60, high: 16 },
    urbanization: { urban: 70, suburban: 10, rural: 20 },
  },
  ESB: {
    ethnicity: { russian: 80, ukrainian: 2, central_asian: 0, caucasian: 0, other: 18 },
    age: { young: 33, mid: 28, mature: 22, senior: 17 },
    education: { primary_or_below: 26, secondary: 52, vocational: 14, university: 8 },
    income: { low: 26, middle: 60, high: 14 },
    urbanization: { urban: 68, suburban: 10, rural: 22 },
  },
  FEA: {
    ethnicity: { russian: 86, ukrainian: 3, central_asian: 0, caucasian: 0, other: 11 },
    age: { young: 33, mid: 29, mature: 22, senior: 16 },
    education: { primary_or_below: 24, secondary: 52, vocational: 16, university: 8 },
    income: { low: 24, middle: 60, high: 16 },
    urbanization: { urban: 74, suburban: 10, rural: 16 },
  },
  KAZ: {
    ethnicity: { russian: 41, ukrainian: 6, central_asian: 36, caucasian: 0, other: 17 },
    age: { young: 38, mid: 28, mature: 20, senior: 14 },
    education: { primary_or_below: 28, secondary: 50, vocational: 14, university: 8 },
    income: { low: 30, middle: 58, high: 12 },
    urbanization: { urban: 54, suburban: 12, rural: 34 },
  },
  TRA: {
    ethnicity: { russian: 7, ukrainian: 0, central_asian: 0, caucasian: 90, other: 3 },
    age: { young: 36, mid: 28, mature: 22, senior: 14 },
    education: { primary_or_below: 26, secondary: 48, vocational: 16, university: 10 },
    income: { low: 30, middle: 58, high: 12 },
    urbanization: { urban: 52, suburban: 12, rural: 36 },
  },
  CAS: {
    ethnicity: { russian: 8, ukrainian: 0, central_asian: 88, caucasian: 0, other: 4 },
    age: { young: 45, mid: 28, mature: 17, senior: 10 },
    education: { primary_or_below: 35, secondary: 48, vocational: 12, university: 5 },
    income: { low: 40, middle: 52, high: 8 },
    urbanization: { urban: 38, suburban: 10, rural: 52 },
  },
  MOL: {
    ethnicity: { russian: 11, ukrainian: 14, central_asian: 0, caucasian: 0, other: 75 },
    age: { young: 34, mid: 28, mature: 22, senior: 16 },
    education: { primary_or_below: 30, secondary: 50, vocational: 13, university: 7 },
    income: { low: 32, middle: 56, high: 12 },
    urbanization: { urban: 40, suburban: 10, rural: 50 },
  },
};

export default ruRegionCensusData;
