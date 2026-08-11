/**
 * Nigeria Region Census Profiles — Layer 1 (1979, the Second Republic).
 *
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Authored for ~1979 directly. NOT imported/transformed from ngRegionCensusData.ts.
 * Primary sources: 1963 Nigeria Census (last reliable before 1991); USAID
 * estimates; World Bank Nigeria country reports 1978–80.
 *
 * Era context (1979-default):
 * - Olusegun Obasanjo's military government transitions to Shehu Shagari's
 *   civilian Second Republic (presidential elections October 1979).
 * - Oil boom: Nigeria is the world's 6th-largest oil producer; petrodollar
 *   revenue transforming Lagos, Port Harcourt, and Kano.
 * - Universal Primary Education (UPE) programme launched 1976 — enrolment
 *   tripling but quality patchy; secondary and tertiary still very limited.
 * - Urbanization rising fast (rural–urban migration driven by oil wealth):
 *   ~27% urban nationally, vs ~8% in 1953.
 * - Population ~75M (est.); still very young (median age ~17).
 *
 * Key 1979 vs 1953 changes:
 * - Education HIGHER: UPE driving basic literacy up (from ~20% to ~34%);
 *   secondary still rare; tertiary tiny
 * - Urbanization HIGHER: Lagos ~2.5M; Port Harcourt, Kano booming
 * - Income HIGHER in SOUTH_SOUTH (oil money); North still very poor
 * - Age: still extremely young; slight ageing vs 1953
 *
 * Keys match NGRegionLayer1 in ngRegionCensusData.ts.
 * Each dimension sums to 100.
 */

import type { NGRegionLayer1 } from "./ngRegionCensusData";

export const ngRegionCensusData1979: Record<string, NGRegionLayer1> = {
  NORTH_WEST: {
    // Kano emirate; Hausa-Fulani Islamic majority; groundnut agriculture
    // declining post-Sahel drought; oil wealth not penetrating here.
    religion: { muslim: 84, christian: 10, other: 6 },
    ethnicity: { hausa_fulani: 80, yoruba: 0, igbo: 0, minority: 20 },
    age: { young: 52, mid: 30, mature: 13, senior: 5 },
    education: { basic: 82, secondary: 15, tertiary: 3 },
    income: { low: 70, middle: 26, high: 4 },
    urbanization: { urban: 14, suburban: 10, rural: 76 },
  },
  NORTH_EAST: {
    // Borno / Adamawa: lowest literacy in Nigeria; pastoral Fulani;
    // Kanuri south shore of Lake Chad; extreme rural poverty.
    religion: { muslim: 66, christian: 26, other: 8 },
    ethnicity: { hausa_fulani: 42, yoruba: 0, igbo: 0, minority: 58 },
    age: { young: 54, mid: 29, mature: 12, senior: 5 },
    education: { basic: 88, secondary: 10, tertiary: 2 },
    income: { low: 78, middle: 19, high: 3 },
    urbanization: { urban: 8, suburban: 10, rural: 82 },
  },
  NORTH_CENTRAL: {
    // Jos Plateau / Benue / Kwara: minority "Middle Belt" peoples;
    // tin/columbite mining; farming. More Christian; NPC/UPN contested zone.
    religion: { muslim: 38, christian: 54, other: 8 },
    ethnicity: { hausa_fulani: 5, yoruba: 2, igbo: 1, minority: 92 },
    age: { young: 50, mid: 30, mature: 14, senior: 6 },
    education: { basic: 78, secondary: 18, tertiary: 4 },
    income: { low: 65, middle: 30, high: 5 },
    urbanization: { urban: 14, suburban: 14, rural: 72 },
  },
  SOUTH_WEST: {
    // Yoruba belt: Lagos (booming oil capital), Ibadan, Abeokuta.
    // Highest education, most urban outside Port Harcourt; UPN stronghold.
    religion: { muslim: 44, christian: 50, other: 6 },
    ethnicity: { hausa_fulani: 1, yoruba: 88, igbo: 2, minority: 9 },
    age: { young: 44, mid: 32, mature: 17, senior: 7 },
    education: { basic: 54, secondary: 36, tertiary: 10 },
    income: { low: 38, middle: 48, high: 14 },
    urbanization: { urban: 40, suburban: 22, rural: 38 },
  },
  SOUTH_SOUTH: {
    // Niger Delta: Rivers, Cross River, Bendel states; oil boomtown
    // Port Harcourt; Ijaw/Edo/Efik minorities; oil wealth + social tension.
    religion: { muslim: 2, christian: 92, other: 6 },
    ethnicity: { hausa_fulani: 0, yoruba: 2, igbo: 10, minority: 88 },
    age: { young: 46, mid: 32, mature: 16, senior: 6 },
    education: { basic: 62, secondary: 30, tertiary: 8 },
    income: { low: 40, middle: 44, high: 16 },
    urbanization: { urban: 30, suburban: 20, rural: 50 },
  },
  SOUTH_EAST: {
    // Igbo heartland: Anambra, Imo, Enugu; post-Biafra War rebuilding;
    // IKENGA/NPN contested; trading culture, mission schools.
    religion: { muslim: 1, christian: 96, other: 3 },
    ethnicity: { hausa_fulani: 0, yoruba: 0, igbo: 93, minority: 7 },
    age: { young: 46, mid: 32, mature: 16, senior: 6 },
    education: { basic: 58, secondary: 34, tertiary: 8 },
    income: { low: 46, middle: 44, high: 10 },
    urbanization: { urban: 24, suburban: 20, rural: 56 },
  },
};

export default ngRegionCensusData1979;
