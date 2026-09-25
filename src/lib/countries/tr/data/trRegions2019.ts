import type { State } from "@/lib/db/types";
import { trRegions } from "./trRegions";

/**
 * Modern population and assembly overlay for the eight existing TR simulation
 * regions. The weights come from Turkey's 2013 NUTS-1 regional population table,
 * grouped into the simulation's eight regions and normalized to the 83.4 million
 * people in the 2019 national budget. This is an explicit proxy until the
 * province-level modern region bundle tracked in #2317 is authored.
 *
 * Source: Republic of Turkey Ministry of Development, Regional Development
 * National Strategy, ABPRS 2013 table (TR1..TRC):
 * https://www.kalkinmakutuphanesi.gov.tr/assets/upload/dosyalar/regional-development.pdf
 *
 * Assembly seats use the 600-seat Grand National Assembly, apportioned by the
 * largest-remainder method on the same weights. Turkey has no Senate in 2019.
 * Geographic IDs and GDP weights are retained from the existing eight-region
 * model; the bootstrap GDP reconciliation scales them to the national budget.
 */
const MODERN_REGION_POPULATION_AND_SEATS: Record<
  string,
  { population: number; houseDistricts: number }
> = {
  TR_IST: { population: 26_800_849, houseDistricts: 193 },
  TR_ANK: { population: 8_008_719, houseDistricts: 58 },
  TR_IZM: { population: 10_766_387, houseDistricts: 78 },
  TR_MED: { population: 10_623_645, houseDistricts: 76 },
  TR_BLA: { population: 7_672_045, houseDistricts: 55 },
  TR_ESA: { population: 6_507_474, houseDistricts: 47 },
  TR_SEA: { population: 8_807_285, houseDistricts: 63 },
  TR_CEN: { population: 4_213_596, houseDistricts: 30 },
};

export const trRegions2019: State[] = trRegions.map((region) => ({
  ...region,
  ...MODERN_REGION_POPULATION_AND_SEATS[region._id],
  stateSenateSeats: 0,
}));

export default trRegions2019;
