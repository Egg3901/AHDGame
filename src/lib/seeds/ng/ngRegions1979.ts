/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 1979 directly.
 * Type-only imports are allowed.
 *
 * Nigeria's 6 geopolitical zones for the 1979-default preset (the Second
 * Republic — Shagari's election, the return to civilian rule under the 1979
 * constitution). The 6 zones are structurally stable; the era-specific values
 * are ~1979 population and zone GDP (NGN millions, tunable scale; a small
 * pre-devaluation oil economy).
 *
 * SCOPE NOTE: this file supplies the era-scaled REGIONS only. The deeper Second-
 * Republic fidelity — the historical 19-state structure and the NPN/UPN/NPP/PRP/
 * GNPP five-party system with 1979 vote shares — is a separate, larger task
 * (NG parties + calibration, per the seed-completion handoff) and is NOT modelled
 * here; the 6-zone playable structure and `houseDistricts`/`stateSenateSeats`
 * remain the era-invariant Fourth-Republic NASS scaling.
 */
import type { State } from "@/lib/db/types";

export const ngRegions1979: State[] = [
  {
    _id: "NORTH_WEST",
    countryId: "NG",
    regionType: "state",
    name: "North-West",
    population: 18_500_000,
    gdp: 24_000_000,
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
    population: 9_500_000,
    gdp: 15_000_000,
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
    population: 10_000_000,
    gdp: 19_000_000,
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
    population: 14_000_000,
    gdp: 40_000_000,
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
    population: 10_500_000,
    gdp: 34_000_000,
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
    population: 8_500_000,
    gdp: 18_000_000,
    houseDistricts: 43,
    stateSenateSeats: 16,
    region: "South-East",
    votingSystem: "fptp",
  },
];

export default ngRegions1979;
