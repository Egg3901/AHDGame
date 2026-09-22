import type { State } from "@/lib/db/types";

/**
 * Spain regions — 1953-era values (Francoist Spain).
 *
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Values authored for 1953 directly. Spain 1953: pop ≈ 28.2M (1950 census);
 * GDP ≈ 440B pesetas nominal. Franco's autarky regime; 1953 was the year of
 * the Concordat with the Vatican and the US Mutual Defense Assistance Pact.
 * The Cortes Franquistas (corporatist parliament) had no competitive elections.
 *
 * - `population` — 1950 census estimates.
 * - `gdp` — regional GDP in millions of pesetas (ESP).
 * - `houseDistricts` — Cortes Franquistas seats (nominal; sum ≈ 350 procuradores).
 * - `stateSenateSeats` — regime-era representation (notional).
 * - `votingSystem` — rcv (approximation; elections were not free).
 */
export const esRegions1953: State[] = [
  {
    _id: "ES_MAD",
    countryId: "ES",
    regionType: "state",
    name: "Madrid",
    population: 2_300_000,
    gdp: 92_000,
    houseDistricts: 32,
    stateSenateSeats: 18,
    region: "Madrid",
    votingSystem: "rcv",
  },
  {
    _id: "ES_CAT",
    countryId: "ES",
    regionType: "state",
    name: "Catalonia",
    population: 3_200_000,
    gdp: 110_000,
    houseDistricts: 44,
    stateSenateSeats: 24,
    region: "Catalonia",
    votingSystem: "rcv",
  },
  {
    _id: "ES_AND",
    countryId: "ES",
    regionType: "state",
    name: "Andalusia",
    population: 5_600_000,
    gdp: 82_000,
    houseDistricts: 66,
    stateSenateSeats: 36,
    region: "South",
    votingSystem: "rcv",
  },
  {
    _id: "ES_VAL",
    countryId: "ES",
    regionType: "state",
    name: "Valencia & Murcia",
    population: 3_100_000,
    gdp: 60_000,
    houseDistricts: 40,
    stateSenateSeats: 22,
    region: "East",
    votingSystem: "rcv",
  },
  {
    _id: "ES_PVB",
    countryId: "ES",
    regionType: "state",
    name: "Basque Country & Navarre",
    population: 1_500_000,
    gdp: 48_000,
    houseDistricts: 20,
    stateSenateSeats: 12,
    region: "North",
    votingSystem: "rcv",
  },
  {
    _id: "ES_GAL",
    countryId: "ES",
    regionType: "state",
    name: "Galicia",
    population: 2_600_000,
    gdp: 25_000,
    houseDistricts: 31,
    stateSenateSeats: 17,
    region: "Northwest",
    votingSystem: "rcv",
  },
  {
    _id: "ES_NOR",
    countryId: "ES",
    regionType: "state",
    name: "Northern Spain",
    population: 2_400_000,
    gdp: 40_000,
    houseDistricts: 28,
    stateSenateSeats: 16,
    region: "North",
    votingSystem: "rcv",
  },
  {
    _id: "ES_CEN",
    countryId: "ES",
    regionType: "state",
    name: "Central Spain & Islands",
    population: 7_500_000,
    gdp: 98_000,
    houseDistricts: 89,
    stateSenateSeats: 63,
    region: "Center",
    votingSystem: "rcv",
  },
];

export default esRegions1953;
