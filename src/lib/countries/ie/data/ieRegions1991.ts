import type { State } from "@/lib/db/types";

/**
 * Ireland NUTS III planning regions, 1991 Census + 1991 nominal regional
 * GDP (EUR-equivalent, scaled from the 1991 IEP series).
 *
 * Population: 1991 CSO Census.
 * GDP: 1991 nominal regional GVA, calibrated to a realistic ~$12k/capita
 *   national average (≈88% of real 1991 Irish GDP/cap, ~$13.4k), consistent
 *   with how the other countries are seeded (DE/US land ≈85-90% of real
 *   per-capita). An earlier pass under-seeded IE at ~$8k/cap (~$28.8B total),
 *   leaving Ireland anomalously poor — and, at that scale, generating
 *   effectively zero commodity supply/demand so it never appeared in trade.
 *   Distribution preserved (Dublin-weighted); total lifted to ~$41.7B.
 * Dáil seat allocation: per-region magnitudes matching the IE_DAIL_1991
 *   historical seats (160 total — DUB 64 / KIL 13 / MID 10 / WEX 14 / LIM 11 /
 *   COR 18 / GAL 14 / DON 16). Must agree with the seated Dáil (IE_DAIL_1991)
 *   and the 160-seat config so per-region general elections refill exactly the
 *   seats held.
 */
export const ieRegions1991: State[] = [
  {
    _id: "DUB",
    countryId: "IE" as const,
    regionType: "region",
    name: "Dublin",
    population: 1_025_000,
    gdp: 16_000,
    houseDistricts: 64,
    stateSenateSeats: 9,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    _id: "KIL",
    countryId: "IE" as const,
    regionType: "region",
    name: "Kildare",
    population: 326_000,
    gdp: 3_600,
    houseDistricts: 13,
    stateSenateSeats: 8,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    _id: "MID",
    countryId: "IE" as const,
    regionType: "region",
    name: "Midlands",
    population: 202_000,
    gdp: 1_800,
    houseDistricts: 10,
    stateSenateSeats: 7,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    _id: "WEX",
    countryId: "IE" as const,
    regionType: "region",
    name: "Wexford",
    population: 384_000,
    gdp: 3_600,
    houseDistricts: 14,
    stateSenateSeats: 7,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    _id: "LIM",
    countryId: "IE" as const,
    regionType: "region",
    name: "Limerick",
    population: 309_000,
    gdp: 4_000,
    houseDistricts: 11,
    stateSenateSeats: 7,
    region: "Munster",
    votingSystem: "rcv",
  },
  {
    _id: "COR",
    countryId: "IE" as const,
    regionType: "region",
    name: "Cork",
    population: 545_000,
    gdp: 6_100,
    houseDistricts: 18,
    stateSenateSeats: 8,
    region: "Munster",
    votingSystem: "rcv",
  },
  {
    _id: "GAL",
    countryId: "IE" as const,
    regionType: "region",
    name: "Galway",
    population: 348_000,
    gdp: 3_300,
    houseDistricts: 14,
    stateSenateSeats: 7,
    region: "Connacht",
    votingSystem: "rcv",
  },
  {
    _id: "DON",
    countryId: "IE" as const,
    regionType: "region",
    name: "Donegal",
    population: 386_000,
    gdp: 3_300,
    houseDistricts: 16,
    stateSenateSeats: 7,
    region: "Ulster",
    votingSystem: "rcv",
  },
];
