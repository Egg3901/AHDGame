/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 2007 directly.
 * Type-only imports are allowed.
 *
 * Ireland NUTS-III regions for the 2007-default preset (30th Dáil, the Celtic
 * Tiger peak / Ahern FF). The 8 planning regions are structurally stable; the
 * era-specific values are 2007 population, ~2007 regional GDP (EUR millions),
 * and the **166-seat** Dáil distribution in force 1981–2011. `stateSenateSeats`
 * is structural.
 */
import type { State } from "@/lib/db/types";

export const ieRegions2007: State[] = [
  {
    _id: "DUB",
    countryId: "IE",
    regionType: "region",
    name: "Dublin",
    population: 1_300_000,
    gdp: 78_000,
    houseDistricts: 48,
    stateSenateSeats: 9,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    _id: "KIL",
    countryId: "IE",
    regionType: "region",
    name: "Kildare",
    population: 510_000,
    gdp: 18_000,
    houseDistricts: 18,
    stateSenateSeats: 8,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    _id: "MID",
    countryId: "IE",
    regionType: "region",
    name: "Midlands",
    population: 280_000,
    gdp: 9_000,
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
    population: 430_000,
    gdp: 13_000,
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
    population: 390_000,
    gdp: 17_000,
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
    population: 590_000,
    gdp: 28_000,
    houseDistricts: 22,
    stateSenateSeats: 8,
    region: "Munster",
    votingSystem: "rcv",
  },
  {
    _id: "GAL",
    countryId: "IE",
    regionType: "region",
    name: "Galway",
    population: 430_000,
    gdp: 16_000,
    houseDistricts: 16,
    stateSenateSeats: 7,
    region: "Connacht",
    votingSystem: "rcv",
  },
  {
    _id: "DON",
    countryId: "IE",
    regionType: "region",
    name: "Donegal",
    population: 450_000,
    gdp: 11_000,
    houseDistricts: 20,
    stateSenateSeats: 7,
    region: "Ulster",
    votingSystem: "rcv",
  },
];

export default ieRegions2007;
