/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 1999 directly.
 * Type-only imports are allowed.
 *
 * Nigeria's 6 geopolitical zones for the 1999-default preset (the return to
 * civilian rule — Obasanjo's election, start of the Fourth Republic). The 6
 * zones are structurally stable; the era-specific values are late-1990s
 * population and zone GDP (NGN millions, tunable scale).
 * `houseDistricts`/`stateSenateSeats` are structural.
 */
import type { State } from "@/lib/db/types";

export const ngRegions1999: State[] = [
  {
    _id: "NORTH_WEST",
    countryId: "NG",
    regionType: "state",
    name: "North-West",
    population: 30_500_000,
    gdp: 60_000_000,
    houseDistricts: 95,
    stateSenateSeats: 21,
    region: "North-West",
    votingSystem: "fptp",
  },
  {
    _id: "NORTH_EAST",
    countryId: "NG",
    regionType: "state",
    name: "North-East",
    population: 15_800_000,
    gdp: 38_000_000,
    houseDistricts: 50,
    stateSenateSeats: 18,
    region: "North-East",
    votingSystem: "fptp",
  },
  {
    _id: "NORTH_CENTRAL",
    countryId: "NG",
    regionType: "state",
    name: "North-Central",
    population: 16_700_000,
    gdp: 49_000_000,
    houseDistricts: 53,
    stateSenateSeats: 18,
    region: "North-Central",
    votingSystem: "fptp",
  },
  {
    _id: "SOUTH_WEST",
    countryId: "NG",
    regionType: "state",
    name: "South-West",
    population: 23_200_000,
    gdp: 100_000_000,
    houseDistricts: 72,
    stateSenateSeats: 18,
    region: "South-West",
    votingSystem: "fptp",
  },
  {
    _id: "SOUTH_SOUTH",
    countryId: "NG",
    regionType: "state",
    name: "South-South",
    population: 17_800_000,
    gdp: 87_000_000,
    houseDistricts: 47,
    stateSenateSeats: 18,
    region: "South-South",
    votingSystem: "fptp",
  },
  {
    _id: "SOUTH_EAST",
    countryId: "NG",
    regionType: "state",
    name: "South-East",
    population: 14_500_000,
    gdp: 46_000_000,
    houseDistricts: 43,
    stateSenateSeats: 16,
    region: "South-East",
    votingSystem: "fptp",
  },
];

export default ngRegions1999;
