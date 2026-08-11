/**
 * Nigeria Region Census Profiles — 1953 era (British colonial Nigeria).
 *
 * 1953-default companion to {@link ngRegionCensusData} (the 2019 profiles).
 * Anchored on the 1952–53 Nigerian Population Census (British colonial
 * administration).
 *
 * Era context: Nigeria was a British Crown Colony in 1953, independence
 * coming only in October 1960. The colonial population census of 1952–53
 * recorded ~31.6 million Nigerians. Formal education was almost exclusively
 * mission-run primary schools; secondary and university education were tiny
 * elite preserves (the University College of Ibadan opened 1948 with ~100
 * students). Oil had not yet been discovered (first commercial find 1956,
 * production 1958). The economy was entirely agriculture: cocoa (SW), palm
 * oil (SE), groundnuts (N). Lagos was the only real urban centre. The six
 * modern geopolitical zones are anachronistic for 1953 (the colonial
 * structure was N/E/W regions) but the game uses them for consistency.
 * Income is very low across the board. Product decision 2026-07-25: Nigeria is
 * Tier-1 full-autonomous economy-preview in 1953 (self-governing under the
 * Macpherson/Lyttleton trajectory); this census overlay feeds that seed pack.
 * Player open remains blocked on billLifecycle parity.
 */

import type { NGRegionLayer1 } from "./ngRegionCensusData";

export const ngRegionCensusData1953: Record<string, NGRegionLayer1> = {
  NORTH_WEST: {
    religion: { muslim: 82, christian: 12, other: 6 },
    ethnicity: { hausa_fulani: 78, yoruba: 1, igbo: 0, minority: 21 },
    age: { young: 48, mid: 27, mature: 16, senior: 9 },
    education: { basic: 92, secondary: 7, tertiary: 1 },
    income: { low: 82, middle: 16, high: 2 },
    urbanization: { urban: 8, suburban: 8, rural: 84 },
  },
  NORTH_EAST: {
    religion: { muslim: 63, christian: 28, other: 9 },
    ethnicity: { hausa_fulani: 44, yoruba: 0, igbo: 0, minority: 56 },
    age: { young: 50, mid: 26, mature: 15, senior: 9 },
    education: { basic: 94, secondary: 5, tertiary: 1 },
    income: { low: 86, middle: 12, high: 2 },
    urbanization: { urban: 5, suburban: 8, rural: 87 },
  },
  NORTH_CENTRAL: {
    religion: { muslim: 40, christian: 50, other: 10 },
    ethnicity: { hausa_fulani: 4, yoruba: 2, igbo: 1, minority: 93 },
    age: { young: 48, mid: 27, mature: 16, senior: 9 },
    education: { basic: 90, secondary: 8, tertiary: 2 },
    income: { low: 80, middle: 17, high: 3 },
    urbanization: { urban: 7, suburban: 10, rural: 83 },
  },
  SOUTH_WEST: {
    // Yoruba cocoa belt; Lagos; mission-school education the best in Nigeria.
    religion: { muslim: 44, christian: 50, other: 6 },
    ethnicity: { hausa_fulani: 1, yoruba: 90, igbo: 1, minority: 8 },
    age: { young: 46, mid: 27, mature: 17, senior: 10 },
    education: { basic: 70, secondary: 26, tertiary: 4 },
    income: { low: 60, middle: 34, high: 6 },
    urbanization: { urban: 22, suburban: 18, rural: 60 },
  },
  SOUTH_SOUTH: {
    // Niger Delta; palm oil; oil not yet discovered.
    religion: { muslim: 2, christian: 92, other: 6 },
    ethnicity: { hausa_fulani: 0, yoruba: 2, igbo: 8, minority: 90 },
    age: { young: 48, mid: 26, mature: 16, senior: 10 },
    education: { basic: 78, secondary: 19, tertiary: 3 },
    income: { low: 72, middle: 24, high: 4 },
    urbanization: { urban: 10, suburban: 15, rural: 75 },
  },
  SOUTH_EAST: {
    // Igbo heartland; palm oil; densely settled; mission schools thriving.
    religion: { muslim: 1, christian: 96, other: 3 },
    ethnicity: { hausa_fulani: 0, yoruba: 0, igbo: 94, minority: 6 },
    age: { young: 48, mid: 26, mature: 16, senior: 10 },
    education: { basic: 75, secondary: 22, tertiary: 3 },
    income: { low: 68, middle: 28, high: 4 },
    urbanization: { urban: 12, suburban: 16, rural: 72 },
  },
};
