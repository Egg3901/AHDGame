import type { State } from "@/lib/db/types";

/**
 * France regions as State-compatible documents (1979-era; France is a 1979-preset
 * Tier-2 Econ country). Differentiated by `countryId: "FR"`.
 *
 * SEED INDEPENDENCE — values authored for ~1979 directly (1979 France: pop ≈ 53.4M;
 * GDP ≈ FFr 2,500B nominal). Eight macro-regions group the pre-1982 régions.
 *
 * - `population` — ~1979 estimates (people).
 * - `gdp` — regional GDP in millions of French francs (FRF).
 * - `houseDistricts` — National Assembly seats (1978 boundaries; sum ≈ 491).
 * - `stateSenateSeats` — Senate seats apportioned across the macro-regions
 *     (sum = 305, matching the configured national chamber).
 * - `region` — grouping for regional filters.
 * - `votingSystem` — rcv (two-round runoff approximation).
 */
export const frRegions: State[] = [
  {
    _id: "FR_IDF",
    countryId: "FR",
    regionType: "state",
    name: "Île-de-France",
    population: 9_900_000,
    gdp: 700_000,
    houseDistricts: 93,
    stateSenateSeats: 59,
    region: "Île-de-France",
    votingSystem: "rcv",
  },
  {
    _id: "FR_NOR",
    countryId: "FR",
    regionType: "state",
    name: "North",
    population: 5_700_000,
    gdp: 230_000,
    houseDistricts: 52,
    stateSenateSeats: 32,
    region: "North",
    votingSystem: "rcv",
  },
  {
    _id: "FR_EST",
    countryId: "FR",
    regionType: "state",
    name: "East",
    population: 6_000_000,
    gdp: 250_000,
    houseDistricts: 55,
    stateSenateSeats: 34,
    region: "East",
    votingSystem: "rcv",
  },
  {
    _id: "FR_OUE",
    countryId: "FR",
    regionType: "state",
    name: "West",
    population: 8_600_000,
    gdp: 360_000,
    houseDistricts: 79,
    stateSenateSeats: 49,
    region: "West",
    votingSystem: "rcv",
  },
  {
    _id: "FR_SOU",
    countryId: "FR",
    regionType: "state",
    name: "Southwest",
    population: 6_400_000,
    gdp: 270_000,
    houseDistricts: 59,
    stateSenateSeats: 36,
    region: "Southwest",
    votingSystem: "rcv",
  },
  {
    _id: "FR_ARA",
    countryId: "FR",
    regionType: "state",
    name: "Auvergne-Rhône-Alpes",
    population: 6_300_000,
    gdp: 320_000,
    houseDistricts: 58,
    stateSenateSeats: 36,
    region: "Rhône-Alpes",
    votingSystem: "rcv",
  },
  {
    _id: "FR_MED",
    countryId: "FR",
    regionType: "state",
    name: "Mediterranean",
    population: 5_800_000,
    gdp: 250_000,
    houseDistricts: 53,
    stateSenateSeats: 33,
    region: "Mediterranean",
    votingSystem: "rcv",
  },
  {
    _id: "FR_CEN",
    countryId: "FR",
    regionType: "state",
    name: "Center",
    population: 4_600_000,
    gdp: 200_000,
    houseDistricts: 42,
    stateSenateSeats: 26,
    region: "Center",
    votingSystem: "rcv",
  },
];

export default frRegions;
