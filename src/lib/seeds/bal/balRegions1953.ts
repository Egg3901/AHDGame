import type { State } from "@/lib/db/types";

/**
 * Baltic republics 1953 — three union republics, one per titular nation
 * (Estonian SSR, Latvian SSR, Lithuanian SSR).
 *
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Authored for ~1953 directly. Region ids match the map shard
 * `public/bal-regions.json` (see src/lib/maps/balGeometry.ts); the same three
 * codes carry through to the 1979 preset, so there is one shard and no era
 * variant.
 *
 * Political setting: annexed in 1940 under the Molotov-Ribbentrop secret
 * protocol, occupied by Germany 1941-44, re-annexed in 1944. Forced
 * collectivisation was pushed through in 1949-51 on the back of the March 1949
 * Operation Priboi deportations (roughly 90,000 people to Siberia in three
 * days), and the Forest Brothers insurgency is still being mopped up in the
 * early 1950s. This is the most recently and most violently Sovietised
 * territory in the seeded world.
 *
 * POPULATION BASIS. Totals are the game's own scale, not the raw historical
 * headcount (the real 1953 figure is nearer 5.7M). The seeded 2,900,000 is
 * fixed by the country's budget/seat configuration and the three republics
 * split it in their true relative proportions (roughly 43 / 34 / 22, the
 * 1959 census shares of Lithuania / Latvia / Estonia). Do not "correct" one
 * republic without rebalancing the other two: the three MUST sum to 2,900,000.
 *
 * GDP BASIS. Millions of Soviet rubles, the same unit and the same Western
 * GNP-estimate basis as src/lib/seeds/ru/ruRegions1953.ts, so the two are
 * directly comparable. The three sum to 29,167 (₽29.167bn), giving ₽10,057 per
 * head against the RSFSR-inclusive Union average of about ₽7,000 — the Baltics
 * were the richest territory in the USSR per capita and the seed says so.
 * Within that, Latvia leads on output per head (Riga's electronics and
 * machine-building: VEF radios, RVR railway carriages, the Riga wagon works),
 * Estonia follows on the Kohtla-Jarve oil shale basin and its unusually high
 * consumer standard, and Lithuania trails because it is still overwhelmingly a
 * farm economy.
 *
 * houseDistricts = Supreme Soviet seats. They sum to 300, matching the
 * coalitionThreshold of 151 in the BAL country config
 * (src/lib/constants/countries.ts). Apportioned by population.
 */
export const balRegions1953: State[] = [
  {
    _id: "BAL_LTU",
    countryId: "BAL",
    regionType: "state",
    name: "Lithuania",
    population: 1_250_000,
    gdp: 10_667, // ₽8,534 per head — the poorest of the three, still a peasant economy
    houseDistricts: 129,
    stateSenateSeats: 0,
    region: "Baltics",
    votingSystem: "fptp",
  },
  {
    _id: "BAL_LVA",
    countryId: "BAL",
    regionType: "state",
    name: "Latvia",
    population: 1_000_000,
    gdp: 11_500, // ₽11,500 per head — Riga's machine-building carries the whole republic
    houseDistricts: 104,
    stateSenateSeats: 0,
    region: "Baltics",
    votingSystem: "fptp",
  },
  {
    _id: "BAL_EST",
    countryId: "BAL",
    regionType: "state",
    name: "Estonia",
    population: 650_000,
    gdp: 7_000, // ₽10,769 per head — oil shale plus the Union's best living standard
    houseDistricts: 67,
    stateSenateSeats: 0,
    region: "Baltics",
    votingSystem: "fptp",
  },
];
export default balRegions1953;
