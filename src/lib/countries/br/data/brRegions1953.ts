/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 1953 directly.
 * Type-only imports are allowed.
 *
 * Brazil IBGE macro-regions for the 1953-default preset (Vargas's second
 * government 1951–54 — Petrobras founded 1953; getulismo vs UDN opposition).
 * The 5 macro-regions are structurally stable; era-specific values are 1950-IBGE-
 * census population, ~1953 regional GDP (BRL/cruzeiro millions, nominal), and
 * the **304-seat** Chamber of Deputies distribution of the 1950 legislature.
 *
 * NOTE: illiterates (~52%) were barred from voting under the 1946 Constitution,
 * effectively halving the electorate vs population figures.
 */
import type { State } from "@/lib/db/types";

export const brRegions1953: State[] = [
  {
    _id: "NORTE",
    countryId: "BR",
    regionType: "state",
    name: "Norte",
    population: 1_844_000,
    gdp: 12_000,
    houseDistricts: 11,
    stateSenateSeats: 21,
    region: "Norte",
    votingSystem: "fptp",
  },
  {
    _id: "NORDESTE",
    countryId: "BR",
    regionType: "state",
    name: "Nordeste",
    population: 17_974_000,
    gdp: 48_000,
    houseDistricts: 105,
    stateSenateSeats: 27,
    region: "Nordeste",
    votingSystem: "fptp",
  },
  {
    _id: "CENTRO_OESTE",
    countryId: "BR",
    regionType: "state",
    name: "Centro-Oeste",
    population: 1_735_000,
    gdp: 9_000,
    houseDistricts: 10,
    stateSenateSeats: 12,
    region: "Centro-Oeste",
    votingSystem: "fptp",
  },
  {
    _id: "SUDESTE",
    countryId: "BR",
    regionType: "state",
    name: "Sudeste",
    population: 22_549_000,
    gdp: 198_000,
    houseDistricts: 132,
    stateSenateSeats: 12,
    region: "Sudeste",
    votingSystem: "fptp",
  },
  {
    _id: "SUL",
    countryId: "BR",
    regionType: "state",
    name: "Sul",
    population: 7_840_000,
    gdp: 53_000,
    houseDistricts: 46,
    stateSenateSeats: 9,
    region: "Sul",
    votingSystem: "fptp",
  },
];

export default brRegions1953;
