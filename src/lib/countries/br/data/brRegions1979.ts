/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 1979 directly.
 * Type-only imports are allowed.
 *
 * Brazil IBGE macro-regions for the 1979-default preset (the Figueiredo military
 * government / start of the abertura; the ARENA–MDB controlled-bipartisan era,
 * just before the 1979 party reform). The 5 macro-regions are structurally
 * stable; the era-specific values are 1980-census population, ~1979 regional GDP
 * (BRL-equivalent millions, nominal — a pre-Real, pre-stabilization economy),
 * and the **420-seat** Chamber distribution of the 1978 legislature.
 *
 * NOTE (anachronism): `stateSenateSeats` keeps the modern 81-seat Senate split;
 * in 1979 Brazil had fewer states (several northern territories were not yet
 * states) and a 67-seat Senate — the structural seat count is era-invariant here.
 */
import type { State } from "@/lib/db/types";

export const brRegions1979: State[] = [
  {
    _id: "NORTE",
    countryId: "BR",
    regionType: "state",
    name: "Norte",
    population: 6_600_000,
    gdp: 12_000,
    houseDistricts: 40,
    stateSenateSeats: 21,
    region: "Norte",
    votingSystem: "fptp",
  },
  {
    _id: "NORDESTE",
    countryId: "BR",
    regionType: "state",
    name: "Nordeste",
    population: 35_000_000,
    gdp: 45_000,
    houseDistricts: 130,
    stateSenateSeats: 27,
    region: "Nordeste",
    votingSystem: "fptp",
  },
  {
    _id: "CENTRO_OESTE",
    countryId: "BR",
    regionType: "state",
    name: "Centro-Oeste",
    population: 7_000_000,
    gdp: 15_000,
    houseDistricts: 30,
    stateSenateSeats: 12,
    region: "Centro-Oeste",
    votingSystem: "fptp",
  },
  {
    _id: "SUDESTE",
    countryId: "BR",
    regionType: "state",
    name: "Sudeste",
    population: 51_000_000,
    gdp: 185_000,
    houseDistricts: 165,
    stateSenateSeats: 12,
    region: "Sudeste",
    votingSystem: "fptp",
  },
  {
    _id: "SUL",
    countryId: "BR",
    regionType: "state",
    name: "Sul",
    population: 19_000_000,
    gdp: 50_000,
    houseDistricts: 55,
    stateSenateSeats: 9,
    region: "Sul",
    votingSystem: "fptp",
  },
];

export default brRegions1979;
