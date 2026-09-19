import type { State } from "@/lib/db/types";

/** Austria 1953 — the occupied Second Republic. Pop ~6.93M; GDP in millions
 *  of schilling. The ÖVP–SPÖ grand coalition governs under four-power
 *  occupation; Marshall Plan reconstruction; the Soviet zone (Lower Austria,
 *  Burgenland, east Vienna) hosts USIA-seized industry.
 *
 *  COLONIES/OCCUPATION-SYSTEM note (user-directed): the four-power occupation
 *  is NOT modelled — Austria plays as an ordinary sovereign republic in this
 *  preset. When an occupation/colonies system lands, 1953 Austria should gain
 *  occupied-zone mechanics and the State Treaty as an exit event.
 *
 *  Same five macro-regions as 1979. houseDistricts sums to the 165-seat
 *  pre-1971 Nationalrat (matching the 1953 config override). */
export const atRegions1953: State[] = [
  {
    _id: "AT_VIE",
    countryId: "AT",
    regionType: "state",
    name: "Vienna",
    population: 1_620_000,
    gdp: 26_000,
    houseDistricts: 39,
    stateSenateSeats: 0,
    region: "Vienna",
    votingSystem: "rcv",
  },
  {
    _id: "AT_NOE",
    countryId: "AT",
    regionType: "state",
    name: "Lower Austria & Burgenland",
    population: 1_650_000,
    gdp: 19_000,
    houseDistricts: 39,
    stateSenateSeats: 0,
    region: "East",
    votingSystem: "rcv",
  },
  {
    _id: "AT_OOE",
    countryId: "AT",
    regionType: "state",
    name: "Upper Austria & Salzburg",
    population: 1_500_000,
    gdp: 18_000,
    houseDistricts: 36,
    stateSenateSeats: 0,
    region: "Danube",
    votingSystem: "rcv",
  },
  {
    _id: "AT_STK",
    countryId: "AT",
    regionType: "state",
    name: "Styria & Carinthia",
    population: 1_600_000,
    gdp: 16_000,
    houseDistricts: 38,
    stateSenateSeats: 0,
    region: "South",
    votingSystem: "rcv",
  },
  {
    _id: "AT_TYR",
    countryId: "AT",
    regionType: "state",
    name: "Tyrol & Vorarlberg",
    population: 560_000,
    gdp: 6_000,
    houseDistricts: 13,
    stateSenateSeats: 0,
    region: "Alpine West",
    votingSystem: "rcv",
  },
];
export default atRegions1953;
