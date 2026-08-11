/**
 * East Germany Region Census Profiles — Layer 1 (1979, the GDR). DD is
 * 1979-preset-only here. SEED INDEPENDENCE — authored for ~1979.
 *
 * Keyed by the eastern-Länder region codes (`BEO BB MV ST SN TH`). The GDR was
 * ethnically homogeneous; variance comes from the urban capital (East Berlin),
 * the industrial south (Saxony/Thuringia), and the more agrarian north
 * (Mecklenburg/Brandenburg). Incomes are compressed (planned economy, low
 * inequality). Each dim sums 100.
 */
export interface DDRegionLayer1 {
  ethnicity: { german: number; other: number };
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

export const ddRegionCensusData: Record<string, DDRegionLayer1> = {
  // Capital — privileged, highly urban, best-educated.
  BEO: {
    ethnicity: { german: 98, other: 2 },
    age: { young: 26, mid: 30, mature: 24, senior: 20 },
    education: { primary_or_below: 26, secondary: 30, vocational: 32, university: 12 },
    income: { low: 22, middle: 64, high: 14 },
    urbanization: { urban: 96, suburban: 4, rural: 0 },
  },
  // Agrarian north.
  MV: {
    ethnicity: { german: 98, other: 2 },
    age: { young: 24, mid: 27, mature: 25, senior: 24 },
    education: { primary_or_below: 38, secondary: 30, vocational: 26, university: 6 },
    income: { low: 32, middle: 62, high: 6 },
    urbanization: { urban: 48, suburban: 14, rural: 38 },
  },
  BB: {
    ethnicity: { german: 98, other: 2 },
    age: { young: 25, mid: 27, mature: 25, senior: 23 },
    education: { primary_or_below: 36, secondary: 30, vocational: 28, university: 6 },
    income: { low: 30, middle: 64, high: 6 },
    urbanization: { urban: 56, suburban: 16, rural: 28 },
  },
  // Central — the chemical belt (Halle/Bitterfeld), more industrial than the north.
  ST: {
    ethnicity: { german: 98, other: 2 },
    age: { young: 25, mid: 28, mature: 25, senior: 22 },
    education: { primary_or_below: 33, secondary: 30, vocational: 30, university: 7 },
    income: { low: 28, middle: 65, high: 7 },
    urbanization: { urban: 64, suburban: 14, rural: 22 },
  },
  // Industrial south.
  SN: {
    ethnicity: { german: 98, other: 2 },
    age: { young: 25, mid: 28, mature: 25, senior: 22 },
    education: { primary_or_below: 30, secondary: 30, vocational: 32, university: 8 },
    income: { low: 26, middle: 66, high: 8 },
    urbanization: { urban: 73, suburban: 13, rural: 14 },
  },
  TH: {
    ethnicity: { german: 98, other: 2 },
    age: { young: 25, mid: 28, mature: 25, senior: 22 },
    education: { primary_or_below: 31, secondary: 30, vocational: 31, university: 8 },
    income: { low: 27, middle: 65, high: 8 },
    urbanization: { urban: 64, suburban: 16, rural: 20 },
  },
};

export default ddRegionCensusData;
