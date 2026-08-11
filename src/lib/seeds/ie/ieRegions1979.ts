/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 1979 directly.
 * Type-only imports are allowed.
 *
 * Ireland NUTS-III regions for the 1979-default preset (21st Dáil, the Lynch/
 * Haughey FF era — pre-Celtic-Tiger, high-emigration Ireland). The 8 planning
 * regions are structurally stable; the era-specific values are ~1979 population,
 * ~1979 regional GDP (EUR millions, nominal — a small agrarian economy), and the
 * **148-seat** Dáil distribution of the 1977–1981 period. `stateSenateSeats`
 * is structural.
 */
import type { State } from "@/lib/db/types";

export const ieRegions1979: State[] = [
  {
    _id: "DUB",
    countryId: "IE",
    regionType: "region",
    name: "Dublin",
    population: 980_000,
    gdp: 5_500,
    houseDistricts: 40,
    stateSenateSeats: 9,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    _id: "KIL",
    countryId: "IE",
    regionType: "region",
    name: "Kildare",
    population: 290_000,
    gdp: 1_400,
    houseDistricts: 14,
    stateSenateSeats: 8,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    _id: "MID",
    countryId: "IE",
    regionType: "region",
    name: "Midlands",
    population: 195_000,
    gdp: 800,
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
    population: 360_000,
    gdp: 1_200,
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
    population: 295_000,
    gdp: 1_500,
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
    population: 520_000,
    gdp: 2_200,
    houseDistricts: 21,
    stateSenateSeats: 8,
    region: "Munster",
    votingSystem: "rcv",
  },
  {
    _id: "GAL",
    countryId: "IE",
    regionType: "region",
    name: "Galway",
    population: 330_000,
    gdp: 1_300,
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
    population: 375_000,
    gdp: 1_100,
    houseDistricts: 19,
    stateSenateSeats: 7,
    region: "Ulster",
    votingSystem: "rcv",
  },
];

export default ieRegions1979;
