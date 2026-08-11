/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 2007 directly.
 * Type-only imports are allowed.
 *
 * Brazil IBGE macro-regions for the 2007-default preset (Lula's second term,
 * the commodity boom). The 5 macro-regions are structurally stable; the
 * era-specific values are 2007 population and ~2007 regional GDP (BRL millions),
 * with the **513-seat** Chamber distribution from the 1994 redistribution in
 * force 1994–2014. `stateSenateSeats` is structural.
 */
import type { State } from "@/lib/db/types";

export const brRegions2007: State[] = [
  {
    _id: "NORTE",
    countryId: "BR",
    regionType: "state",
    name: "Norte",
    population: 15_300_000,
    gdp: 130_000,
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
    population: 52_500_000,
    gdp: 350_000,
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
    population: 14_000_000,
    gdp: 240_000,
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
    population: 80_000_000,
    gdp: 1_560_000,
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
    population: 27_500_000,
    gdp: 450_000,
    houseDistricts: 77,
    stateSenateSeats: 9,
    region: "Sul",
    votingSystem: "fptp",
  },
];

export default brRegions2007;
