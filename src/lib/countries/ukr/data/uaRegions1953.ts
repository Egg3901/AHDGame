import type { State } from "@/lib/db/types";

/**
 * Ukraine (Ukrainian SSR) 1953 - Stalin's death year. Pop 41.0M; gdp in
 * millions of Soviet rubles, the same basis as src/lib/seeds/ru/ruRegions1953.ts
 * (the Western GNP-estimate rescale that makes the regional rollup agree with
 * the hand-authored FY-1953 budget seed). The national totals here are exactly
 * the values the union-level seed carries for its `UKR` region (41,000,000 /
 * 291,667), so promoting Ukraine to a playable country does not silently move
 * the USSR's economy.
 *
 * SEED INDEPENDENCE - DO NOT DERIVE FROM ANOTHER ERA.
 * Authored for ~1953 directly; the six macro-regions match the shard at
 * public/ua-regions.json and are shared with the 1979 bundle (uaRegions.ts).
 *
 * The 1953 republic, region by region:
 * - Reconstruction is the whole story. Ukraine lost something like a sixth of
 *   its people and most of its industrial plant between 1941 and 1944, and the
 *   1946-47 famine came on top of that. The Fourth and Fifth Five-Year Plans
 *   poured capital into rebuilding the pre-war industrial map rather than
 *   drawing a new one, so output is concentrated exactly where it was in 1940:
 *   Donbas coal, Dnieper metallurgy and hydroelectricity.
 * - Donbas and the Dnieper belt together carry just over half of republican
 *   output on about 39% of the population. That is the whole economic point of
 *   the Ukrainian SSR to Moscow.
 * - Western Ukraine (Galicia, Volhynia, Transcarpathia, Bukovina) was annexed
 *   in 1939-45 and is the poorest region by a wide margin: agrarian, Greek
 *   Catholic (the Uniate church was forcibly dissolved in 1946), and still
 *   being pacified. The UPA insurgency was fought down only in the early
 *   1950s, with mass deportations either side of it. It holds the second
 *   largest population and barely a ninth of the output.
 * - Podolia is the small agrarian centre: sugar beet, no heavy industry.
 * - The Black Sea coast is ports and shipbuilding (Odesa, Mykolaiv, Kherson)
 *   over a farming hinterland. NOTE: Crimea was still an RSFSR oblast in 1953
 *   and only transferred to the Ukrainian SSR in February 1954. The map shard's
 *   southern polygon includes the peninsula because the geometry is drawn on
 *   the post-1954 republic; the population and output authored here are sized
 *   for the coastal oblasts as they stood, so the region reads correctly for a
 *   game that starts in 1953 and runs forward past the transfer.
 *
 * houseDistricts = seats in the Supreme Soviet of the Ukrainian SSR (435),
 * apportioned by population with largest remainder. stateSenateSeats is 0:
 * a union republic has one chamber, not two.
 */
export const uaRegions1953: State[] = [
  {
    _id: "UKR_KYI",
    countryId: "UKR",
    regionType: "state",
    name: "Kyiv and the Right Bank",
    population: 8_000_000,
    gdp: 55_000,
    houseDistricts: 85,
    stateSenateSeats: 0,
    region: "Kyiv",
    votingSystem: "fptp",
  },
  {
    _id: "UKR_WES",
    countryId: "UKR",
    regionType: "state",
    // Annexed 1939-45, agrarian, and the only region with a living armed
    // resistance in the seed's own decade. Lowest output per head in the
    // republic by a factor of three against the Dnieper belt.
    name: "Western Ukraine",
    population: 8_500_000,
    gdp: 32_667,
    houseDistricts: 90,
    stateSenateSeats: 0,
    region: "West",
    votingSystem: "fptp",
  },
  {
    _id: "UKR_POD",
    countryId: "UKR",
    regionType: "state",
    name: "Podolia",
    population: 3_500_000,
    gdp: 19_000,
    houseDistricts: 37,
    stateSenateSeats: 0,
    region: "Podolia",
    votingSystem: "fptp",
  },
  {
    _id: "UKR_DON",
    countryId: "UKR",
    regionType: "state",
    // Coal. Highest output per head (₽10,833) - the mines were restored first
    // and at almost any cost, because the whole union's fuel balance depended
    // on them.
    name: "Donbas",
    population: 6_000_000,
    gdp: 65_000,
    houseDistricts: 64,
    stateSenateSeats: 0,
    region: "Donbas",
    votingSystem: "fptp",
  },
  {
    _id: "UKR_DNI",
    countryId: "UKR",
    regionType: "state",
    // Kryvyi Rih ore, Zaporizhzhia and Dnipropetrovsk metallurgy, DniproHES
    // rebuilt and back on line in 1950. Largest population and largest output.
    name: "Dnieper Industrial Belt",
    population: 10_000_000,
    gdp: 85_000,
    houseDistricts: 106,
    stateSenateSeats: 0,
    region: "Dnieper",
    votingSystem: "fptp",
  },
  {
    _id: "UKR_SOU",
    countryId: "UKR",
    regionType: "state",
    name: "Black Sea Coast",
    population: 5_000_000,
    gdp: 35_000,
    houseDistricts: 53,
    stateSenateSeats: 0,
    region: "South",
    votingSystem: "fptp",
  },
];
export default uaRegions1953;
