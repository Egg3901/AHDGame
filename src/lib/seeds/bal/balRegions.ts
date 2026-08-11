import type { State } from "@/lib/db/types";

/**
 * Baltic republics 1979 (late Brezhnev) — the same three union republics as the
 * 1953 preset, so the map shard `public/bal-regions.json` serves both eras.
 *
 * Population 7,400,000 combined, matching the "BAL" entry in
 * `makeEasternBlocBudget` (src/lib/seeds/reference/budgets.ts). The split
 * follows the 1979 Soviet census: Lithuania 3.40M, Latvia 2.50M, Estonia
 * 1.46M. Twenty-six years of Russian in-migration into the two northern
 * republics is the single biggest change from 1953 and it is carried in
 * balRegionCensusData.ts, not here.
 *
 * GDP in millions of Soviet rubles; the three sum to 420,000 (₽420bn), the
 * figure the 1979 budget seed uses. Per head that is roughly ₽62,000 in
 * Estonia, ₽60,000 in Latvia and ₽52,000 in Lithuania — the northern two stay
 * ahead on industry and on the consumer allocations that came with being the
 * Union's showcase republics, while Lithuania has closed part but not all of
 * the gap through the Mazeikiai refinery, Jonava chemicals and the Ignalina
 * construction programme.
 *
 * houseDistricts = Supreme Soviet seats, apportioned by population by largest
 * remainder; sum = 300 (coalitionThreshold 151 in the BAL country config).
 */
export const balRegions: State[] = [
  {
    _id: "BAL_LTU",
    countryId: "BAL",
    regionType: "state",
    name: "Lithuania",
    population: 3_400_000,
    gdp: 177_000,
    houseDistricts: 138,
    stateSenateSeats: 0,
    region: "Baltics",
    votingSystem: "fptp",
  },
  {
    _id: "BAL_LVA",
    countryId: "BAL",
    regionType: "state",
    name: "Latvia",
    population: 2_500_000,
    gdp: 150_000,
    houseDistricts: 101,
    stateSenateSeats: 0,
    region: "Baltics",
    votingSystem: "fptp",
  },
  {
    _id: "BAL_EST",
    countryId: "BAL",
    regionType: "state",
    name: "Estonia",
    population: 1_500_000,
    gdp: 93_000,
    houseDistricts: 61,
    stateSenateSeats: 0,
    region: "Baltics",
    votingSystem: "fptp",
  },
];
export default balRegions;
