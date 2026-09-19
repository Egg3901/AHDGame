import type { State } from "@/lib/db/types";

/**
 * Japan regions as State-compatible documents.
 *
 * Japan uses 8 game regions (each containing multiple prefectures) as the
 * playable tier. Prefectures are metadata only — the game region is the parent.
 *
 * Population figures approximate 2020 census data.
 * GDP in millions of JPY (approximate 2020 prefectural GDP sums).
 * `houseDistricts` = Shugiin (House of Representatives) seats per region.
 * `stateSenateSeats` = Prefectural assembly (Regional Council) seats per region.
 *   Matches the US/UK pattern: sub-national legislature seats, not national upper chamber.
 *   Sangiin seat counts live in `JP_SANGIIN_SEATS` constant (src/lib/constants/states.ts).
 *   Each region participates in both Sangiin classes — half seats contested per class.
 *
 * Seat totals: Shugiin = 465, Sangiin = 248, Regional Council = 2,679.
 */
export const jpRegions: State[] = [
  {
    _id: "HOK",
    countryId: "JP",
    regionType: "region",
    name: "Hokkaido",
    population: 5_200_000,
    gdp: 19_300_000, // ~19.3 trillion JPY
    houseDistricts: 12,
    stateSenateSeats: 100,
    region: "Hokkaido",
    votingSystem: "fptp",
  },
  {
    _id: "TOH",
    countryId: "JP",
    regionType: "region",
    name: "Tohoku",
    population: 8_600_000,
    gdp: 33_500_000,
    houseDistricts: 37,
    stateSenateSeats: 299,
    region: "Tohoku",
    votingSystem: "fptp",
  },
  {
    _id: "KAN",
    countryId: "JP",
    regionType: "region",
    name: "Kanto",
    population: 43_500_000,
    gdp: 213_000_000,
    houseDistricts: 150,
    stateSenateSeats: 581,
    region: "Kanto",
    votingSystem: "fptp",
  },
  {
    _id: "CHU",
    countryId: "JP",
    regionType: "region",
    name: "Chubu",
    population: 21_100_000,
    gdp: 82_000_000,
    houseDistricts: 81,
    stateSenateSeats: 483,
    region: "Chubu",
    votingSystem: "fptp",
  },
  {
    _id: "KNS",
    countryId: "JP",
    regionType: "region",
    name: "Kansai",
    population: 22_500_000,
    gdp: 85_000_000,
    houseDistricts: 82,
    stateSenateSeats: 414,
    region: "Kansai",
    votingSystem: "fptp",
  },
  {
    _id: "CGK",
    countryId: "JP",
    regionType: "region",
    name: "Chugoku",
    population: 7_100_000,
    gdp: 28_500_000,
    houseDistricts: 28,
    stateSenateSeats: 238,
    region: "Chugoku",
    votingSystem: "fptp",
  },
  {
    _id: "SHI",
    countryId: "JP",
    regionType: "region",
    name: "Shikoku",
    population: 3_700_000,
    gdp: 13_800_000,
    houseDistricts: 14,
    stateSenateSeats: 163,
    region: "Shikoku",
    votingSystem: "fptp",
  },
  {
    _id: "KYU",
    countryId: "JP",
    regionType: "region",
    name: "Kyushu & Okinawa",
    population: 14_300_000,
    gdp: 50_600_000,
    houseDistricts: 61,
    stateSenateSeats: 401,
    region: "Kyushu",
    votingSystem: "fptp",
  },
];
