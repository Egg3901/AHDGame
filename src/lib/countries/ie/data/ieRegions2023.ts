/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 2023 directly.
 * Type-only imports are allowed.
 *
 * Ireland NUTS-III regions for the 2023-default preset (33rd Dáil, the
 * FF–FG–Green coalition). The 8 planning regions are structurally stable; the
 * era-specific values are 2023 CSO population, ~2022 regional GDP (EUR millions,
 * multinational-inflated), and the **160-seat** Dáil distribution from the 2020
 * election. `stateSenateSeats` (Seanad, 60) is structural.
 */
import type { State } from "@/lib/db/types";

export const ieRegions2023: State[] = [
  {
    _id: "DUB",
    countryId: "IE",
    regionType: "region",
    name: "Dublin",
    population: 1_458_000,
    gdp: 180_000,
    houseDistricts: 49,
    stateSenateSeats: 9,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    _id: "KIL",
    countryId: "IE",
    regionType: "region",
    name: "Kildare",
    population: 610_000,
    gdp: 42_000,
    houseDistricts: 21,
    stateSenateSeats: 8,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    _id: "MID",
    countryId: "IE",
    regionType: "region",
    name: "Midlands",
    population: 315_000,
    gdp: 18_000,
    houseDistricts: 11,
    stateSenateSeats: 7,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    _id: "WEX",
    countryId: "IE",
    regionType: "region",
    name: "Wexford",
    population: 389_000,
    gdp: 28_000,
    houseDistricts: 13,
    stateSenateSeats: 7,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    _id: "LIM",
    countryId: "IE",
    regionType: "region",
    name: "Limerick",
    population: 432_000,
    gdp: 38_000,
    houseDistricts: 15,
    stateSenateSeats: 7,
    region: "Munster",
    votingSystem: "rcv",
  },
  {
    _id: "COR",
    countryId: "IE",
    regionType: "region",
    name: "Cork",
    population: 598_000,
    gdp: 65_000,
    houseDistricts: 20,
    stateSenateSeats: 8,
    region: "Munster",
    votingSystem: "rcv",
  },
  {
    _id: "GAL",
    countryId: "IE",
    regionType: "region",
    name: "Galway",
    population: 453_000,
    gdp: 35_000,
    houseDistricts: 15,
    stateSenateSeats: 7,
    region: "Connacht",
    votingSystem: "rcv",
  },
  {
    _id: "DON",
    countryId: "IE",
    regionType: "region",
    name: "Donegal",
    population: 485_000,
    gdp: 25_000,
    houseDistricts: 16,
    stateSenateSeats: 7,
    region: "Ulster",
    votingSystem: "rcv",
  },
];

export default ieRegions2023;
