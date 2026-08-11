import type { State } from "@/lib/db/types";

/** Finland 1953 — the postwar republic. Pop ~4.15M; GDP in millions of OLD
 *  markka (pre-1963 unit; redenominated 100:1 — see INITIAL_RATES_1953).
 *  War reparations to the USSR delivered in full (1952), ~420,000 Karelian
 *  evacuees resettled on smallholdings, the Helsinki Olympics just held;
 *  Agrarian–SDP coalitions govern under President Paasikivi's eastern line.
 *
 *  Same six macro-regions as 1979; the countryside — especially the resettled
 *  east — carries far more demographic weight. houseDistricts sums to the
 *  200-seat Eduskunta. */
export const fiRegions1953: State[] = [
  {
    _id: "FI_UUS",
    countryId: "FI",
    regionType: "state",
    name: "Uusimaa",
    population: 740_000,
    gdp: 210_000,
    houseDistricts: 36,
    stateSenateSeats: 0,
    region: "Helsinki",
    votingSystem: "rcv",
  },
  {
    _id: "FI_SW",
    countryId: "FI",
    regionType: "state",
    name: "Southwest Finland",
    population: 570_000,
    gdp: 115_000,
    houseDistricts: 27,
    stateSenateSeats: 0,
    region: "Southwest",
    votingSystem: "rcv",
  },
  {
    _id: "FI_HAM",
    countryId: "FI",
    regionType: "state",
    name: "Häme & Central Finland",
    population: 880_000,
    gdp: 170_000,
    houseDistricts: 42,
    stateSenateSeats: 0,
    region: "Lakeland",
    votingSystem: "rcv",
  },
  {
    _id: "FI_EAS",
    countryId: "FI",
    regionType: "state",
    name: "Eastern Finland",
    population: 1_020_000,
    gdp: 155_000,
    houseDistricts: 49,
    stateSenateSeats: 0,
    region: "Karelia",
    votingSystem: "rcv",
  },
  {
    _id: "FI_OST",
    countryId: "FI",
    regionType: "state",
    name: "Ostrobothnia",
    population: 770_000,
    gdp: 120_000,
    houseDistricts: 37,
    stateSenateSeats: 0,
    region: "Bothnia",
    votingSystem: "rcv",
  },
  {
    _id: "FI_LAP",
    countryId: "FI",
    regionType: "state",
    name: "Lapland",
    population: 170_000,
    gdp: 20_000,
    houseDistricts: 9,
    stateSenateSeats: 0,
    region: "Arctic North",
    votingSystem: "rcv",
  },
];
export default fiRegions1953;
