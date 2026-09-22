import type { State } from "@/lib/db/types";

/**
 * Japan regions, 1990 Census + 1991 nominal prefectural GDP (JPY millions).
 *
 * Population: 1990 Japan Census (Statistics Bureau).
 * GDP: 1991 prefectural GDP, summed to game regions.
 *   Source: Cabinet Office annual prefectural GDP series (1990-91 nominal).
 * House districts and stateSenateSeats track the 1986-94 medium-constituency
 * (chuusenkyoku) Shugiin system — 512 total seats, distributed proportionally
 * to game regions. Modern stateSenateSeats values are preserved (no separate
 * 1990 prefectural-assembly seat count is modeled).
 *
 * ⚠️ THESE SUMMED TO 511 AGAINST A 512-SEAT CHAMBER. The 1986 reapportionment
 * ("8増7減") put the Shugiin at 512 and the February 1990 election returned
 * that many; 511 is the figure from the 1992 revision, two years after this
 * world starts. The missing seat went to Kanto, by some distance the most
 * under-represented region on this file's own 1990 populations — 267,361
 * people per seat against Shikoku's 209,750, which is the malapportionment the
 * Supreme Court's vote-value rulings were about and is deliberately preserved
 * rather than evened out.
 *
 * `JP_SHUGIIN_SEATS_1991` mirrors these numbers and `JP_SHUGIIN_1990` seats
 * them, so the chamber config, the districts, the roster and the election
 * allocator agree region by region.
 */
export const jpRegions1991: State[] = [
  {
    _id: "HOK",
    countryId: "JP",
    regionType: "region",
    name: "Hokkaido",
    population: 5_644_000,
    gdp: 17_500_000,
    houseDistricts: 23,
    stateSenateSeats: 100,
    region: "Hokkaido",
    votingSystem: "fptp",
  },
  {
    _id: "TOH",
    countryId: "JP",
    regionType: "region",
    name: "Tohoku",
    population: 9_738_000,
    gdp: 27_500_000,
    houseDistricts: 50,
    stateSenateSeats: 299,
    region: "Tohoku",
    votingSystem: "fptp",
  },
  {
    _id: "KAN",
    countryId: "JP",
    regionType: "region",
    name: "Kanto",
    population: 38_500_000,
    gdp: 168_000_000, // ~36% of national bubble-peak GDP
    houseDistricts: 145,
    stateSenateSeats: 581,
    region: "Kanto",
    votingSystem: "fptp",
  },
  {
    _id: "CHU",
    countryId: "JP",
    regionType: "region",
    name: "Chubu",
    population: 20_800_000,
    gdp: 72_000_000,
    houseDistricts: 86,
    stateSenateSeats: 483,
    region: "Chubu",
    votingSystem: "fptp",
  },
  {
    _id: "KNS",
    countryId: "JP",
    regionType: "region",
    name: "Kansai",
    population: 22_700_000,
    gdp: 76_000_000,
    houseDistricts: 92,
    stateSenateSeats: 414,
    region: "Kansai",
    votingSystem: "fptp",
  },
  {
    _id: "CGK",
    countryId: "JP",
    regionType: "region",
    name: "Chugoku",
    population: 7_745_000,
    gdp: 23_500_000,
    houseDistricts: 34,
    stateSenateSeats: 238,
    region: "Chugoku",
    votingSystem: "fptp",
  },
  {
    _id: "SHI",
    countryId: "JP",
    regionType: "region",
    name: "Shikoku",
    population: 4_195_000,
    gdp: 11_000_000,
    houseDistricts: 20,
    stateSenateSeats: 163,
    region: "Shikoku",
    votingSystem: "fptp",
  },
  {
    _id: "KYU",
    countryId: "JP",
    regionType: "region",
    name: "Kyushu & Okinawa",
    population: 14_690_000,
    gdp: 45_000_000,
    houseDistricts: 62,
    stateSenateSeats: 401,
    region: "Kyushu",
    votingSystem: "fptp",
  },
];
