/**
 * Brazil Region Census Profiles — Layer 1 demographic breakdown per
 * macro-region (Grande Região). Mirrors the UK/JP/DE census files.
 *
 * This module owns the {@link BRRegionLayer1} shape. The `2019-default`
 * profiles below are authored in a later task; the `1991-default` companion
 * lives in `brRegionCensusData1991.ts`. The preset registry selects between
 * them at render time.
 *
 * Fields (% of adult population):
 *   ethnicity    — IBGE cor/raça self-classification
 *                  (Branco / Pardo / Preto / Amarelo / Indígena)
 *   age          — Adult (18+) distribution
 *   education    — Highest level of schooling completed
 *   income       — Relative household-income tiers (era-neutral)
 *   urbanization — Urban / peri-urban / rural split
 */

export interface BRRegionLayer1 {
  ethnicity: {
    branco: number;
    pardo: number;
    preto: number;
    amarelo: number;
    indigena: number;
  };
  age: { young: number; mid: number; mature: number; senior: number };
  education: { fundamental: number; medio: number; superior: number };
  income: { low: number; middle: number; high: number };
  urbanization: { urban: number; suburban: number; rural: number };
}

/**
 * 2019-default (modern) profiles — approximate IBGE Censo 2022 estimates
 * (% of adult population). Keys stay in sync with {@link brRegionCensusData1991}
 * and `REGION_CENSUS_LABELS.BR`.
 *
 * Directional vs the 1991 profiles: higher `superior` attainment and higher
 * urbanization across every region; pardo share rises as self-classification
 * shifts. The South stays the most branco region.
 */
export const brRegionCensusData: Record<string, BRRegionLayer1> = {
  NORTE: {
    ethnicity: { branco: 20, pardo: 68, preto: 7, amarelo: 1, indigena: 4 },
    age: { young: 30, mid: 28, mature: 28, senior: 14 },
    education: { fundamental: 58, medio: 30, superior: 12 },
    income: { low: 52, middle: 38, high: 10 },
    urbanization: { urban: 72, suburban: 14, rural: 14 },
  },
  NORDESTE: {
    ethnicity: { branco: 25, pardo: 64, preto: 9, amarelo: 1, indigena: 1 },
    age: { young: 30, mid: 28, mature: 28, senior: 14 },
    education: { fundamental: 56, medio: 32, superior: 12 },
    income: { low: 50, middle: 40, high: 10 },
    urbanization: { urban: 74, suburban: 14, rural: 12 },
  },
  CENTRO_OESTE: {
    ethnicity: { branco: 36, pardo: 54, preto: 8, amarelo: 1, indigena: 1 },
    age: { young: 29, mid: 29, mature: 28, senior: 14 },
    education: { fundamental: 48, medio: 36, superior: 16 },
    income: { low: 38, middle: 46, high: 16 },
    urbanization: { urban: 90, suburban: 7, rural: 3 },
  },
  SUDESTE: {
    ethnicity: { branco: 50, pardo: 38, preto: 10, amarelo: 2, indigena: 0 },
    age: { young: 27, mid: 30, mature: 28, senior: 15 },
    education: { fundamental: 44, medio: 36, superior: 20 },
    income: { low: 32, middle: 46, high: 22 },
    urbanization: { urban: 93, suburban: 5, rural: 2 },
  },
  SUL: {
    ethnicity: { branco: 72, pardo: 18, preto: 6, amarelo: 2, indigena: 2 },
    age: { young: 26, mid: 28, mature: 29, senior: 17 },
    education: { fundamental: 46, medio: 36, superior: 18 },
    income: { low: 30, middle: 48, high: 22 },
    urbanization: { urban: 87, suburban: 8, rural: 5 },
  },
};
