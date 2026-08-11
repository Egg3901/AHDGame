/**
 * USSR Region Census Profiles — Layer 1 demographic breakdown per region (1953).
 *
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Authored for ~1953 directly. NOT imported/transformed from ruRegionCensusData.ts.
 *
 * Key 1953 anchors (vs 1979):
 * - Education: HIGHER primary_or_below, LOWER university — mass literacy campaign
 *   was recent; secondary schooling not yet universal in periphery. Completed
 *   higher education nationally was only a few percent by the 1959 census, so
 *   university shares here stay in the low-to-mid single digits outside the
 *   Moscow/Leningrad cores.
 * - Urbanization: LOWER urban, HIGHER rural — the 1926→1959 urbanization surge
 *   was still underway; Central Asia and Caucasus heavily rural. National
 *   urban ≈48% matches the 1959 census.
 * - Ethnicity: similar macro-groupings but Kazakhstan still Russian-plurality
 *   (post-Gulag deportation settlers + prewar colonization).
 * - Age: HIGHER young cohort — postwar baby boom + WWII deaths skewed population
 *   young. Senior share lower (high WWII casualties).
 * - Income: MORE compressed (planned economy, Stalinist wage levelling).
 *
 * Ukraine, Byelorussia and the Baltics used to be RU regions here under the
 * territorial-extent merge. They are separate game countries now (UKR/BLR/BAL)
 * and carry their own census bundles, so their rows have left this file.
 * Titular nationalities of the remaining republics map to the "other"
 * ethnicity bucket.
 * Each dimension sums to 100 (%).
 */

import type { SURegionLayer1 } from "./ruRegionCensusData";

export const ruRegionCensusData1953: Record<string, SURegionLayer1> = {
  // ── RSFSR (Russia) macro-regions ───────────────────────────────────────────
  CEN: {
    ethnicity: { russian: 95, ukrainian: 1, central_asian: 0, caucasian: 0, other: 4 },
    age: { young: 36, mid: 28, mature: 22, senior: 14 }, // postwar baby boom; fewer seniors (WWII losses)
    education: { primary_or_below: 40, secondary: 40, vocational: 14, university: 6 },
    income: { low: 25, middle: 62, high: 13 },
    urbanization: { urban: 65, suburban: 12, rural: 23 },
  },
  NWR: {
    ethnicity: { russian: 92, ukrainian: 2, central_asian: 0, caucasian: 0, other: 6 },
    age: { young: 35, mid: 28, mature: 22, senior: 15 },
    education: { primary_or_below: 38, secondary: 42, vocational: 14, university: 6 },
    income: { low: 26, middle: 62, high: 12 },
    urbanization: { urban: 68, suburban: 10, rural: 22 },
  },
  NOR: {
    ethnicity: { russian: 90, ukrainian: 1, central_asian: 0, caucasian: 0, other: 9 },
    age: { young: 36, mid: 28, mature: 22, senior: 14 },
    education: { primary_or_below: 44, secondary: 38, vocational: 14, university: 4 },
    income: { low: 30, middle: 60, high: 10 },
    urbanization: { urban: 55, suburban: 12, rural: 33 },
  },
  CBE: {
    ethnicity: { russian: 95, ukrainian: 3, central_asian: 0, caucasian: 0, other: 2 },
    age: { young: 35, mid: 27, mature: 23, senior: 15 },
    education: { primary_or_below: 50, secondary: 36, vocational: 11, university: 3 },
    income: { low: 36, middle: 56, high: 8 },
    urbanization: { urban: 40, suburban: 12, rural: 48 }, // heavily rural black-earth farming belt
  },
  VOL: {
    ethnicity: { russian: 76, ukrainian: 1, central_asian: 0, caucasian: 0, other: 23 },
    age: { young: 37, mid: 28, mature: 21, senior: 14 },
    education: { primary_or_below: 46, secondary: 38, vocational: 12, university: 4 },
    income: { low: 32, middle: 58, high: 10 },
    urbanization: { urban: 54, suburban: 10, rural: 36 },
  },
  NCA: {
    ethnicity: { russian: 62, ukrainian: 2, central_asian: 0, caucasian: 30, other: 6 },
    age: { young: 38, mid: 28, mature: 21, senior: 13 },
    education: { primary_or_below: 52, secondary: 36, vocational: 10, university: 2 },
    income: { low: 38, middle: 54, high: 8 },
    urbanization: { urban: 42, suburban: 12, rural: 46 },
  },
  URA: {
    ethnicity: { russian: 82, ukrainian: 1, central_asian: 0, caucasian: 0, other: 17 },
    age: { young: 36, mid: 28, mature: 22, senior: 14 },
    education: { primary_or_below: 42, secondary: 42, vocational: 12, university: 4 },
    income: { low: 30, middle: 60, high: 10 },
    urbanization: { urban: 62, suburban: 10, rural: 28 },
  },
  WSB: {
    ethnicity: { russian: 88, ukrainian: 2, central_asian: 0, caucasian: 0, other: 10 },
    age: { young: 37, mid: 28, mature: 21, senior: 14 },
    education: { primary_or_below: 44, secondary: 40, vocational: 12, university: 4 },
    income: { low: 30, middle: 60, high: 10 },
    urbanization: { urban: 56, suburban: 10, rural: 34 },
  },
  ESB: {
    ethnicity: { russian: 80, ukrainian: 2, central_asian: 0, caucasian: 0, other: 18 },
    age: { young: 38, mid: 29, mature: 21, senior: 12 }, // younger: Gulag labor + settlers
    education: { primary_or_below: 46, secondary: 40, vocational: 12, university: 2 },
    income: { low: 30, middle: 60, high: 10 },
    urbanization: { urban: 54, suburban: 10, rural: 36 },
  },
  FEA: {
    ethnicity: { russian: 85, ukrainian: 4, central_asian: 0, caucasian: 0, other: 11 },
    age: { young: 39, mid: 30, mature: 20, senior: 11 }, // youngest: frontier workers, military
    education: { primary_or_below: 42, secondary: 42, vocational: 12, university: 4 },
    income: { low: 28, middle: 60, high: 12 },
    urbanization: { urban: 62, suburban: 10, rural: 28 },
  },
  KAZ: {
    ethnicity: { russian: 43, ukrainian: 8, central_asian: 38, caucasian: 0, other: 11 },
    age: { young: 40, mid: 28, mature: 20, senior: 12 },
    education: { primary_or_below: 48, secondary: 38, vocational: 10, university: 4 },
    income: { low: 36, middle: 56, high: 8 },
    urbanization: { urban: 40, suburban: 10, rural: 50 },
  },
  TRA: {
    ethnicity: { russian: 6, ukrainian: 0, central_asian: 0, caucasian: 91, other: 3 },
    age: { young: 40, mid: 28, mature: 20, senior: 12 },
    education: { primary_or_below: 46, secondary: 40, vocational: 12, university: 2 },
    income: { low: 38, middle: 54, high: 8 },
    urbanization: { urban: 38, suburban: 10, rural: 52 },
  },
  CAS: {
    ethnicity: { russian: 6, ukrainian: 0, central_asian: 91, caucasian: 0, other: 3 },
    age: { young: 48, mid: 27, mature: 16, senior: 9 }, // extremely young (high birthrate)
    education: { primary_or_below: 54, secondary: 36, vocational: 9, university: 1 },
    income: { low: 48, middle: 46, high: 6 },
    urbanization: { urban: 26, suburban: 8, rural: 66 }, // most rural Soviet region in 1953
  },
  MOL: {
    ethnicity: { russian: 10, ukrainian: 16, central_asian: 0, caucasian: 0, other: 74 },
    age: { young: 38, mid: 28, mature: 20, senior: 14 },
    education: { primary_or_below: 54, secondary: 36, vocational: 8, university: 2 },
    income: { low: 40, middle: 54, high: 6 },
    urbanization: { urban: 24, suburban: 8, rural: 68 }, // newly annexed (1940); very rural
  },
};

export default ruRegionCensusData1953;
