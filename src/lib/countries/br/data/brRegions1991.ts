import type { State } from "@/lib/db/types";

/**
 * Brazil IBGE macro-regions, 1991 Census + 1991 nominal regional GDP (BRL).
 *
 * Population: 1991 IBGE Census.
 * GDP: 1991 nominal Produto Interno Bruto Regional, in "real-equivalent"
 *   BRL (the cruzeiro was replaced by cruzeiro real in 1993, then real in
 *   1994 — pre-stabilization nominal figures are meaningless; values are
 *   scaled to the post-Real-Plan 1994 ratio for in-game consistency).
 *   Source: IBGE Sistema de Contas Regionais.
 * Chamber of Deputies seat allocation: 1990 election seat counts by region
 *   (503 total). Senate allocation: 1990 senate composition (81 seats total).
 */
export const brRegions1991: State[] = [
  {
    _id: "NORTE",
    countryId: "BR",
    regionType: "state",
    name: "Norte",
    population: 10_257_000,
    gdp: 35_000,
    houseDistricts: 45,
    stateSenateSeats: 21,
    region: "Norte",
    votingSystem: "fptp",
  },
  {
    _id: "NORDESTE",
    countryId: "BR",
    regionType: "state",
    name: "Nordeste",
    population: 42_497_000,
    gdp: 130_000,
    houseDistricts: 141,
    stateSenateSeats: 27,
    region: "Nordeste",
    votingSystem: "fptp",
  },
  {
    _id: "CENTRO_OESTE",
    countryId: "BR",
    regionType: "state",
    name: "Centro-Oeste",
    population: 9_412_000,
    gdp: 70_000,
    houseDistricts: 35,
    stateSenateSeats: 12,
    region: "Centro-Oeste",
    votingSystem: "fptp",
  },
  {
    _id: "SUDESTE",
    countryId: "BR",
    regionType: "state",
    name: "Sudeste",
    population: 62_660_000,
    gdp: 525_000,
    houseDistricts: 196,
    stateSenateSeats: 12,
    region: "Sudeste",
    votingSystem: "fptp",
  },
  {
    _id: "SUL",
    countryId: "BR",
    regionType: "state",
    name: "Sul",
    population: 22_117_000,
    gdp: 140_000,
    houseDistricts: 86,
    stateSenateSeats: 9,
    region: "Sul",
    votingSystem: "fptp",
  },
];
