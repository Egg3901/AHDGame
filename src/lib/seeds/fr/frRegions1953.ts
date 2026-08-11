import type { State } from "@/lib/db/types";

/**
 * France regions — 1953-era values (Fourth Republic).
 *
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Values authored for 1953 directly. France 1953: pop ≈ 42.8M (1954 census);
 * GDP ≈ 13,500B FRF nominal. France was fighting in Indochina, under
 * President Auriol, and the Fourth Republic's proportional Assembly had 627
 * seats after the June 1951 election (era config / Nohlen & Stöver).
 *
 * - `population` — 1954 census estimates.
 * - `gdp` — regional GDP in millions of French francs (FRF).
 * - `houseDistricts` — National Assembly seats (Fourth Republic; sum = 627).
 * - `stateSenateSeats` — Council of the Republic seats (Second Chamber).
 * - `votingSystem` — rcv (two-round runoff).
 */
export const frRegions1953: State[] = [
  {
    _id: "FR_IDF",
    countryId: "FR",
    regionType: "state",
    name: "Île-de-France",
    population: 6_600_000,
    gdp: 4_700_000,
    houseDistricts: 146,
    stateSenateSeats: 180,
    region: "Île-de-France",
    votingSystem: "rcv",
  },
  {
    _id: "FR_NOR",
    countryId: "FR",
    regionType: "state",
    name: "North",
    population: 5_000_000,
    gdp: 2_100_000,
    houseDistricts: 86,
    stateSenateSeats: 105,
    region: "North",
    votingSystem: "rcv",
  },
  {
    _id: "FR_EST",
    countryId: "FR",
    regionType: "state",
    name: "East",
    population: 4_100_000,
    gdp: 1_800_000,
    houseDistricts: 63,
    stateSenateSeats: 86,
    region: "East",
    votingSystem: "rcv",
  },
  {
    _id: "FR_OUE",
    countryId: "FR",
    regionType: "state",
    name: "West",
    population: 5_500_000,
    gdp: 1_700_000,
    houseDistricts: 91,
    stateSenateSeats: 115,
    region: "West",
    votingSystem: "rcv",
  },
  {
    _id: "FR_SOU",
    countryId: "FR",
    regionType: "state",
    name: "Southwest",
    population: 3_800_000,
    gdp: 1_300_000,
    houseDistricts: 63,
    stateSenateSeats: 80,
    region: "Southwest",
    votingSystem: "rcv",
  },
  {
    _id: "FR_ARA",
    countryId: "FR",
    regionType: "state",
    name: "Auvergne-Rhône-Alpes",
    population: 4_900_000,
    gdp: 2_200_000,
    houseDistricts: 82,
    stateSenateSeats: 103,
    region: "Rhône-Alpes",
    votingSystem: "rcv",
  },
  {
    _id: "FR_MED",
    countryId: "FR",
    regionType: "state",
    name: "Mediterranean",
    population: 3_300_000,
    gdp: 1_100_000,
    houseDistricts: 54,
    stateSenateSeats: 70,
    region: "Mediterranean",
    votingSystem: "rcv",
  },
  {
    _id: "FR_CEN",
    countryId: "FR",
    regionType: "state",
    name: "Center",
    population: 2_800_000,
    gdp: 800_000,
    houseDistricts: 42,
    stateSenateSeats: 60,
    region: "Center",
    votingSystem: "rcv",
  },
];

export default frRegions1953;
