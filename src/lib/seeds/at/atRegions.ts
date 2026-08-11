import type { State } from "@/lib/db/types";

/** Austria regions (1979; Kreisky's absolute-majority SPÖ era) — five
 *  macro-regions grouping the nine Bundesländer. pop ≈ 7.55M; gdp in millions
 *  of schilling.
 *
 *  houseDistricts = Nationalrat seats, apportioned by population (sum = 183,
 *  matching the country config's lowerChamber seats). */
export const atRegions: State[] = [
  {
    _id: "AT_VIE",
    countryId: "AT",
    regionType: "state",
    name: "Vienna",
    population: 1_530_000,
    gdp: 260_000,
    houseDistricts: 37,
    stateSenateSeats: 0,
    region: "Vienna",
    votingSystem: "rcv",
  },
  {
    _id: "AT_NOE",
    countryId: "AT",
    regionType: "state",
    name: "Lower Austria & Burgenland",
    population: 1_700_000,
    gdp: 200_000,
    houseDistricts: 41,
    stateSenateSeats: 0,
    region: "East",
    votingSystem: "rcv",
  },
  {
    _id: "AT_OOE",
    countryId: "AT",
    regionType: "state",
    name: "Upper Austria & Salzburg",
    population: 1_700_000,
    gdp: 210_000,
    houseDistricts: 41,
    stateSenateSeats: 0,
    region: "Danube",
    votingSystem: "rcv",
  },
  {
    _id: "AT_STK",
    countryId: "AT",
    regionType: "state",
    name: "Styria & Carinthia",
    population: 1_720_000,
    gdp: 180_000,
    houseDistricts: 42,
    stateSenateSeats: 0,
    region: "South",
    votingSystem: "rcv",
  },
  {
    _id: "AT_TYR",
    countryId: "AT",
    regionType: "state",
    name: "Tyrol & Vorarlberg",
    population: 900_000,
    gdp: 70_000,
    houseDistricts: 22,
    stateSenateSeats: 0,
    region: "Alpine West",
    votingSystem: "rcv",
  },
];
export default atRegions;
