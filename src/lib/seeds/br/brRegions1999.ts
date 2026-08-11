/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 1999 directly.
 * Type-only imports are allowed.
 *
 * Brazil IBGE macro-regions for the 1999-default preset (Cardoso's second term,
 * the post-Real-Plan stabilization). The 5 macro-regions are structurally
 * stable; the era-specific values are late-1990s population and ~1999 regional
 * GDP (BRL millions), with the **513-seat** Chamber distribution from the 1994
 * redistribution. `stateSenateSeats` is structural.
 */
import type { State } from "@/lib/db/types";

export const brRegions1999: State[] = [
  {
    _id: "NORTE",
    countryId: "BR",
    regionType: "state",
    name: "Norte",
    population: 12_900_000,
    gdp: 45_000,
    houseDistricts: 65,
    stateSenateSeats: 21,
    region: "Norte",
    votingSystem: "fptp",
  },
  {
    _id: "NORDESTE",
    countryId: "BR",
    regionType: "state",
    name: "Nordeste",
    population: 47_000_000,
    gdp: 130_000,
    houseDistricts: 151,
    stateSenateSeats: 27,
    region: "Nordeste",
    votingSystem: "fptp",
  },
  {
    _id: "CENTRO_OESTE",
    countryId: "BR",
    regionType: "state",
    name: "Centro-Oeste",
    population: 11_600_000,
    gdp: 80_000,
    houseDistricts: 41,
    stateSenateSeats: 12,
    region: "Centro-Oeste",
    votingSystem: "fptp",
  },
  {
    _id: "SUDESTE",
    countryId: "BR",
    regionType: "state",
    name: "Sudeste",
    population: 72_000_000,
    gdp: 590_000,
    houseDistricts: 179,
    stateSenateSeats: 12,
    region: "Sudeste",
    votingSystem: "fptp",
  },
  {
    _id: "SUL",
    countryId: "BR",
    regionType: "state",
    name: "Sul",
    population: 25_000_000,
    gdp: 175_000,
    houseDistricts: 77,
    stateSenateSeats: 9,
    region: "Sul",
    votingSystem: "fptp",
  },
];

export default brRegions1999;
