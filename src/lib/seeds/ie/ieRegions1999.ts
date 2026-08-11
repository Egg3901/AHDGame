/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 1999 directly.
 * Type-only imports are allowed.
 *
 * Ireland NUTS-III regions for the 1999-default preset (28th Dáil, the early
 * Celtic Tiger / Ahern FF–PD). The 8 planning regions are structurally stable;
 * the era-specific values are late-1990s population, ~1999 regional GDP (EUR
 * millions), and the **166-seat** Dáil distribution in force 1981–2011.
 * `stateSenateSeats` is structural.
 */
import type { State } from "@/lib/db/types";

export const ieRegions1999: State[] = [
  {
    _id: "DUB",
    countryId: "IE",
    regionType: "region",
    name: "Dublin",
    population: 1_100_000,
    gdp: 38_000,
    houseDistricts: 47,
    stateSenateSeats: 9,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    _id: "KIL",
    countryId: "IE",
    regionType: "region",
    name: "Kildare",
    population: 370_000,
    gdp: 8_500,
    houseDistricts: 17,
    stateSenateSeats: 8,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    _id: "MID",
    countryId: "IE",
    regionType: "region",
    name: "Midlands",
    population: 215_000,
    gdp: 4_500,
    houseDistricts: 12,
    stateSenateSeats: 7,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    _id: "WEX",
    countryId: "IE",
    regionType: "region",
    name: "Wexford",
    population: 395_000,
    gdp: 7_000,
    houseDistricts: 14,
    stateSenateSeats: 7,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    _id: "LIM",
    countryId: "IE",
    regionType: "region",
    name: "Limerick",
    population: 335_000,
    gdp: 9_000,
    houseDistricts: 16,
    stateSenateSeats: 7,
    region: "Munster",
    votingSystem: "rcv",
  },
  {
    _id: "COR",
    countryId: "IE",
    regionType: "region",
    name: "Cork",
    population: 555_000,
    gdp: 14_000,
    houseDistricts: 23,
    stateSenateSeats: 8,
    region: "Munster",
    votingSystem: "rcv",
  },
  {
    _id: "GAL",
    countryId: "IE",
    regionType: "region",
    name: "Galway",
    population: 375_000,
    gdp: 8_000,
    houseDistricts: 17,
    stateSenateSeats: 7,
    region: "Connacht",
    votingSystem: "rcv",
  },
  {
    _id: "DON",
    countryId: "IE",
    regionType: "region",
    name: "Donegal",
    population: 395_000,
    gdp: 6_000,
    houseDistricts: 20,
    stateSenateSeats: 7,
    region: "Ulster",
    votingSystem: "rcv",
  },
];

export default ieRegions1999;
