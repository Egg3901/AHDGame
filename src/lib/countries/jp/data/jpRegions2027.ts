/**
 * SEED INDEPENDENCE - DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 2027 directly.
 * Type-only imports are allowed.
 *
 * Japan regions for the 2027-default preset (post-2024 Shugiin, post-2025
 * Sangiin; LDP plurality, no lower-house majority).
 *
 * Base: the 2023 bundle values, projected forward 2023 to 2027.
 * Projection assumptions (documented, not computed):
 * - National population follows the Statistics Bureau 2025 census
 *   preliminary: 123.05 million on Oct 1 2025, down 3.10 million (2.5 pct)
 *   from 2020, with only Tokyo and Okinawa growing. Rural game regions
 *   (Tohoku, Shikoku, Chugoku, Hokkaido) lose 3 to 5 pct; Kanto is held
 *   flat by Tokyo in-migration plus record foreign residents.
 *   Source: https://www.stat.go.jp/english/data/jinsui/
 *   Preliminary 2025 census via MIC release May 2026.
 * - Regional GDP is nominal JPY millions, roughly 6 pct above the 2023
 *   bundle (national nominal GDP growth 2023 to 2026). Rounded.
 * - Shugiin apportionment is the 465-seat distribution (289 SMD plus
 *   176 PR across 11 blocs) confirmed by the Dec 2022 reallocation and
 *   first applied at the Oct 27 2024 general election. Game-region seat
 *   counts are held at the 2023 bundle values; the reallocation kept the
 *   465 total and moved only a few SMDs between prefectures.
 *   Results portal: https://www.soumu.go.jp/senkyo/
 * - `stateSenateSeats` (prefectural-assembly seats) is structural and held
 *   constant.
 */
import type { State } from "@/lib/db/types";

export const jpRegions2027: State[] = [
  {
    _id: "HOK",
    countryId: "JP",
    regionType: "region",
    name: "Hokkaido",
    population: 5_050_000,
    gdp: 20_500_000,
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
    population: 8_250_000,
    gdp: 35_500_000,
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
    population: 43_600_000,
    gdp: 226_000_000,
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
    population: 20_750_000,
    gdp: 87_000_000,
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
    population: 22_150_000,
    gdp: 90_000_000,
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
    population: 6_850_000,
    gdp: 30_200_000,
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
    population: 3_530_000,
    gdp: 14_600_000,
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
    population: 14_050_000,
    gdp: 53_600_000,
    houseDistricts: 61,
    stateSenateSeats: 401,
    region: "Kyushu",
    votingSystem: "fptp",
  },
];

export default jpRegions2027;
