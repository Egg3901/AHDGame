/**
 * Nigeria Region Census Profiles — Layer 1 demographic breakdown per
 * geo-political zone. Mirrors the BR/UK/JP/DE census files.
 *
 * This module owns the {@link NGRegionLayer1} shape. The `2019-default`
 * profiles below are approximate NPC/NBS estimates (% of adult population)
 * aligned with the 2006 Census and subsequent Nigerian Bureau of Statistics
 * projections. The preset registry selects between them at render time.
 *
 * Fields (% of adult population):
 *   religion     — Religious self-identification (Muslim / Christian / other)
 *   ethnicity    — Broad ethno-linguistic bloc (Hausa-Fulani / Yoruba / Igbo
 *                  / minority nationalities)
 *   age          — Adult (18+) distribution
 *   education    — Highest level of schooling completed
 *   income       — Relative household-income tiers (era-neutral)
 *   urbanization — Urban / peri-urban / rural split
 */

export interface NGRegionLayer1 {
  religion: { muslim: number; christian: number; other: number };
  ethnicity: { hausa_fulani: number; yoruba: number; igbo: number; minority: number };
  age: { young: number; mid: number; mature: number; senior: number };
  education: { basic: number; secondary: number; tertiary: number };
  income: { low: number; middle: number; high: number };
  urbanization: { urban: number; suburban: number; rural: number };
}

/**
 * 2019-default (modern) profiles — approximate NPC/NBS estimates
 * (% of adult population). Keys stay in sync with `ngRegions.ts` IDs and
 * `REGION_CENSUS_LABELS.NG`.
 *
 * Directional notes:
 *   - North-West and North-East are overwhelmingly Muslim and rural.
 *   - South-South and South-East are overwhelmingly Christian and Igbo/minority.
 *   - North-Central (Middle Belt) is religiously mixed and ethnically minority-heavy.
 *   - South-West is the most urbanised and educationally-attained zone.
 */
export const ngRegionCensusData: Record<string, NGRegionLayer1> = {
  NORTH_WEST: {
    religion: { muslim: 80, christian: 18, other: 2 },
    ethnicity: { hausa_fulani: 75, yoruba: 2, igbo: 1, minority: 22 },
    age: { young: 55, mid: 25, mature: 13, senior: 7 },
    education: { basic: 70, secondary: 22, tertiary: 8 },
    income: { low: 60, middle: 30, high: 10 },
    urbanization: { urban: 30, suburban: 15, rural: 55 },
  },
  NORTH_EAST: {
    religion: { muslim: 60, christian: 38, other: 2 },
    ethnicity: { hausa_fulani: 45, yoruba: 1, igbo: 1, minority: 53 },
    age: { young: 56, mid: 25, mature: 12, senior: 7 },
    education: { basic: 72, secondary: 20, tertiary: 8 },
    income: { low: 65, middle: 27, high: 8 },
    urbanization: { urban: 25, suburban: 15, rural: 60 },
  },
  NORTH_CENTRAL: {
    religion: { muslim: 40, christian: 58, other: 2 },
    ethnicity: { hausa_fulani: 5, yoruba: 3, igbo: 2, minority: 90 },
    age: { young: 54, mid: 26, mature: 13, senior: 7 },
    education: { basic: 60, secondary: 28, tertiary: 12 },
    income: { low: 55, middle: 32, high: 13 },
    urbanization: { urban: 35, suburban: 20, rural: 45 },
  },
  SOUTH_WEST: {
    religion: { muslim: 45, christian: 52, other: 3 },
    ethnicity: { hausa_fulani: 2, yoruba: 88, igbo: 1, minority: 9 },
    age: { young: 52, mid: 27, mature: 14, senior: 7 },
    education: { basic: 35, secondary: 40, tertiary: 25 },
    income: { low: 35, middle: 40, high: 25 },
    urbanization: { urban: 60, suburban: 20, rural: 20 },
  },
  SOUTH_SOUTH: {
    religion: { muslim: 2, christian: 96, other: 2 },
    ethnicity: { hausa_fulani: 1, yoruba: 3, igbo: 8, minority: 88 },
    age: { young: 53, mid: 26, mature: 13, senior: 8 },
    education: { basic: 45, secondary: 35, tertiary: 20 },
    income: { low: 40, middle: 38, high: 22 },
    urbanization: { urban: 45, suburban: 25, rural: 30 },
  },
  SOUTH_EAST: {
    religion: { muslim: 1, christian: 97, other: 2 },
    ethnicity: { hausa_fulani: 1, yoruba: 1, igbo: 92, minority: 6 },
    age: { young: 53, mid: 27, mature: 13, senior: 7 },
    education: { basic: 40, secondary: 38, tertiary: 22 },
    income: { low: 38, middle: 40, high: 22 },
    urbanization: { urban: 45, suburban: 25, rural: 30 },
  },
};
