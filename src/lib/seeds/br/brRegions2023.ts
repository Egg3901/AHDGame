/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 2023 directly.
 * Type-only imports are allowed.
 *
 * Brazil IBGE macro-regions for the 2023-default preset (Lula's third term).
 * The 5 macro-regions are structurally stable; the era-specific values are 2023
 * population and ~2021 regional GDP (BRL millions), with the **513-seat** Chamber
 * distribution from the latest (2018) redistribution. `stateSenateSeats`
 * (Senate, 81) is structural.
 */
import type { State } from "@/lib/db/types";

export const brRegions2023: State[] = [
  {
    _id: "NORTE",
    countryId: "BR",
    regionType: "state",
    name: "Norte",
    population: 18_430_000,
    gdp: 480_000,
    houseDistricts: 75,
    stateSenateSeats: 21,
    region: "Norte",
    votingSystem: "fptp",
  },
  {
    _id: "NORDESTE",
    countryId: "BR",
    regionType: "state",
    name: "Nordeste",
    population: 57_071_000,
    gdp: 1_400_000,
    houseDistricts: 144,
    stateSenateSeats: 27,
    region: "Nordeste",
    votingSystem: "fptp",
  },
  {
    _id: "CENTRO_OESTE",
    countryId: "BR",
    regionType: "state",
    name: "Centro-Oeste",
    population: 16_729_000,
    gdp: 1_200_000,
    houseDistricts: 42,
    stateSenateSeats: 12,
    region: "Centro-Oeste",
    votingSystem: "fptp",
  },
  {
    _id: "SUDESTE",
    countryId: "BR",
    regionType: "state",
    name: "Sudeste",
    population: 88_371_000,
    gdp: 6_200_000,
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
    population: 30_367_000,
    gdp: 1_800_000,
    houseDistricts: 73,
    stateSenateSeats: 9,
    region: "Sul",
    votingSystem: "fptp",
  },
];

export default brRegions2023;
