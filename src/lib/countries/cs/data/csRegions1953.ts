import type { State } from "@/lib/db/types";

/** Czechoslovakia 1953 — Gottwald/Novotný Stalinist era. Pop ~12.4M; GDP in millions of koruna.
 *  Most industrialized Eastern Bloc country — prewar Skoda/ČKD tradition. Uranium from Jáchymov
 *  mined by political prisoners for USSR. Slánský show trials just concluded (Nov 1952).
 *
 *  Four regions (Prague + the historic lands Bohemia, Moravia, Slovakia — the
 *  same set as 1979; in 1953 the state was still unitary but the lands remain
 *  the natural regional cut). Population ~12.4M (1950 Czechoslovak census /
 *  UN mid-decade). houseDistricts sums to the same 200-seat chamber as 1979. */
export const csRegions1953: State[] = [
  {
    _id: "CS_PRG",
    countryId: "CS",
    regionType: "state",
    name: "Prague",
    population: 950_000,
    gdp: 6_000,
    houseDistricts: 15,
    stateSenateSeats: 0,
    region: "Prague",
    votingSystem: "fptp",
  },
  {
    _id: "CS_BOH",
    countryId: "CS",
    regionType: "state",
    name: "Bohemia",
    population: 4_650_000,
    gdp: 26_000,
    houseDistricts: 75,
    stateSenateSeats: 0,
    region: "Bohemia",
    votingSystem: "fptp",
  },
  {
    _id: "CS_MOR",
    countryId: "CS",
    regionType: "state",
    name: "Moravia",
    population: 3_300_000,
    gdp: 18_000,
    houseDistricts: 53,
    stateSenateSeats: 0,
    region: "Moravia",
    votingSystem: "fptp",
  },
  {
    _id: "CS_SVK",
    countryId: "CS",
    regionType: "state",
    name: "Slovakia",
    population: 3_500_000,
    gdp: 15_000,
    houseDistricts: 57,
    stateSenateSeats: 0,
    region: "Slovakia",
    votingSystem: "fptp",
  },
];
export default csRegions1953;
