/**
 * Spain Region Census Profiles — Layer 1 (1979, the Transition). Spain is
 * 1979-preset-only here. SEED INDEPENDENCE — authored for ~1979.
 *
 * "ethnicity" captures regional/national identity, the politically decisive axis:
 * `spanish` (Castilian-Spanish identity), `regional` (strong Catalan / Basque /
 * Galician / Valencian identity), and an aggregated `other`. Combined with the
 * developed–underdeveloped (North–South) income gradient. Each dim sums 100.
 */
export interface ESRegionLayer1 {
  ethnicity: { spanish: number; regional: number; other: number };
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

export const esRegionCensusData: Record<string, ESRegionLayer1> = {
  ES_MAD: {
    ethnicity: { spanish: 95, regional: 2, other: 3 },
    age: { young: 32, mid: 29, mature: 22, senior: 17 },
    education: { primary_or_below: 40, secondary: 36, vocational: 14, university: 10 },
    income: { low: 20, middle: 56, high: 24 },
    urbanization: { urban: 92, suburban: 6, rural: 2 },
  },
  ES_CAT: {
    ethnicity: { spanish: 55, regional: 43, other: 2 },
    age: { young: 30, mid: 29, mature: 23, senior: 18 },
    education: { primary_or_below: 44, secondary: 35, vocational: 14, university: 7 },
    income: { low: 20, middle: 58, high: 22 },
    urbanization: { urban: 82, suburban: 10, rural: 8 },
  },
  ES_AND: {
    ethnicity: { spanish: 96, regional: 2, other: 2 },
    age: { young: 36, mid: 28, mature: 21, senior: 15 },
    education: { primary_or_below: 56, secondary: 30, vocational: 9, university: 5 },
    income: { low: 42, middle: 48, high: 10 },
    urbanization: { urban: 58, suburban: 12, rural: 30 },
  },
  ES_VAL: {
    ethnicity: { spanish: 78, regional: 20, other: 2 },
    age: { young: 32, mid: 29, mature: 22, senior: 17 },
    education: { primary_or_below: 48, secondary: 33, vocational: 12, university: 7 },
    income: { low: 30, middle: 56, high: 14 },
    urbanization: { urban: 70, suburban: 12, rural: 18 },
  },
  ES_PVB: {
    ethnicity: { spanish: 50, regional: 48, other: 2 },
    age: { young: 32, mid: 29, mature: 22, senior: 17 },
    education: { primary_or_below: 42, secondary: 35, vocational: 15, university: 8 },
    income: { low: 22, middle: 58, high: 20 },
    urbanization: { urban: 80, suburban: 10, rural: 10 },
  },
  ES_GAL: {
    ethnicity: { spanish: 60, regional: 38, other: 2 },
    age: { young: 28, mid: 27, mature: 24, senior: 21 },
    education: { primary_or_below: 56, secondary: 30, vocational: 10, university: 4 },
    income: { low: 40, middle: 50, high: 10 },
    urbanization: { urban: 46, suburban: 12, rural: 42 },
  },
  ES_NOR: {
    ethnicity: { spanish: 90, regional: 8, other: 2 },
    age: { young: 30, mid: 28, mature: 23, senior: 19 },
    education: { primary_or_below: 48, secondary: 33, vocational: 13, university: 6 },
    income: { low: 28, middle: 58, high: 14 },
    urbanization: { urban: 66, suburban: 12, rural: 22 },
  },
  ES_CEN: {
    ethnicity: { spanish: 96, regional: 2, other: 2 },
    age: { young: 30, mid: 27, mature: 23, senior: 20 },
    education: { primary_or_below: 56, secondary: 30, vocational: 9, university: 5 },
    income: { low: 38, middle: 52, high: 10 },
    urbanization: { urban: 54, suburban: 12, rural: 34 },
  },
};

export default esRegionCensusData;
