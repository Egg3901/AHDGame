/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 1953 directly.
 * Type-only imports are allowed.
 *
 * Irish regions for the 1953-default preset (de Valera's last Fianna Fáil
 * government 1951–54; Catholic social conservatism; massive emigration crisis;
 * Marshall Aid era austerity). The 8 game regions are structurally stable;
 * era-specific values are ~1951-census population (Republic only: 2.96M),
 * ~1953 regional GDP (GBP millions, nominal), and the **147-seat** Dáil
 * Éireann distribution under the 1948 redistribution (14th Dáil 1954).
 *
 * The `stateSenateSeats` value mirrors the 60-seat Seanad Éireann (era-invariant
 * in this model per the 1979 seed convention) distributed across the 8 regions.
 */
import type { State } from "@/lib/db/types";

export const ieRegions1953: State[] = [
  {
    _id: "DUB",
    countryId: "IE",
    regionType: "constituency",
    name: "Dublin",
    population: 693_000,
    gdp: 185,
    houseDistricts: 42,
    stateSenateSeats: 11,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    _id: "KIL",
    countryId: "IE",
    regionType: "constituency",
    name: "Kildare & Leinster",
    population: 220_000,
    gdp: 50,
    houseDistricts: 16,
    stateSenateSeats: 8,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    _id: "MID",
    countryId: "IE",
    regionType: "constituency",
    name: "Midlands",
    population: 160_000,
    gdp: 35,
    houseDistricts: 11,
    stateSenateSeats: 7,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    _id: "WEX",
    countryId: "IE",
    regionType: "constituency",
    name: "South Leinster & Wexford",
    population: 263_000,
    gdp: 55,
    houseDistricts: 14,
    stateSenateSeats: 7,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    _id: "LIM",
    countryId: "IE",
    regionType: "constituency",
    name: "Limerick & Mid-West",
    population: 380_000,
    gdp: 65,
    houseDistricts: 16,
    stateSenateSeats: 8,
    region: "Munster",
    votingSystem: "rcv",
  },
  {
    _id: "COR",
    countryId: "IE",
    regionType: "constituency",
    name: "Cork & South Munster",
    population: 519_000,
    gdp: 90,
    houseDistricts: 21,
    stateSenateSeats: 9,
    region: "Munster",
    votingSystem: "rcv",
  },
  {
    _id: "GAL",
    countryId: "IE",
    regionType: "constituency",
    name: "Galway & Connacht",
    population: 430_000,
    gdp: 50,
    houseDistricts: 15,
    stateSenateSeats: 6,
    region: "Connacht",
    votingSystem: "rcv",
  },
  {
    _id: "DON",
    countryId: "IE",
    regionType: "constituency",
    name: "Donegal & Ulster",
    population: 295_000,
    gdp: 40,
    houseDistricts: 12,
    stateSenateSeats: 4,
    region: "Ulster",
    votingSystem: "rcv",
  },
];

export default ieRegions1953;
