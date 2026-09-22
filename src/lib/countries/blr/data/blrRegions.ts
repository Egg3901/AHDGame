import type { State } from "@/lib/db/types";

/** Byelorussian SSR 1979 — the same six oblasts as 1953, one shard, no era
 *  variant of the geometry. Pop 9.5M; gdp in millions of Soviet rubles.
 *
 *  By 1979 the republic has become the USSR's machine-building and electronics
 *  showcase: MAZ and BelAZ trucks, MTZ tractors, the Polatsk and Mazyr
 *  refineries running Druzhba pipeline crude, Soligorsk potash at full output,
 *  and Minsk computing plant. Growth is now Soviet-average and slowing, not the
 *  reconstruction surge of the 1950s. Population has finally passed the prewar
 *  level and Minsk oblast has absorbed most of the rural exodus, which is why
 *  its share (30%) is far above its 1953 share (25%).
 *
 *  houseDistricts = Supreme Soviet of the Byelorussian SSR seats, apportioned
 *  by 1979 population, summing to the same 360 as the country config. */
export const blrRegions: State[] = [
  {
    _id: "BLR_MIN",
    countryId: "BLR",
    regionType: "state",
    name: "Minsk",
    population: 2_850_000,
    // Capital oblast plus Minsk City: automotive, tractors, electronics and
    // computing. Roughly a third of republican output on 30% of the people.
    gdp: 165_000,
    houseDistricts: 108,
    stateSenateSeats: 0,
    region: "Minsk",
    votingSystem: "fptp",
  },
  {
    _id: "BLR_HOM",
    countryId: "BLR",
    regionType: "state",
    name: "Gomel",
    population: 1_650_000,
    // Mazyr refinery, Gomel machine tools and agricultural machinery.
    gdp: 78_000,
    houseDistricts: 62,
    stateSenateSeats: 0,
    region: "Gomel",
    votingSystem: "fptp",
  },
  {
    _id: "BLR_VIT",
    countryId: "BLR",
    regionType: "state",
    name: "Vitebsk",
    population: 1_400_000,
    // Polatsk/Navapolatsk petrochemicals, the single largest plant complex
    // outside Minsk, on top of the old textile base.
    gdp: 66_000,
    houseDistricts: 53,
    stateSenateSeats: 0,
    region: "Vitebsk",
    votingSystem: "fptp",
  },
  {
    _id: "BLR_MOG",
    countryId: "BLR",
    regionType: "state",
    name: "Mogilev",
    population: 1_230_000,
    // Synthetic fibre and metallurgy at Mogilev and Babruysk; the slowest
    // grower of the eastern oblasts.
    gdp: 58_000,
    houseDistricts: 47,
    stateSenateSeats: 0,
    region: "Mogilev",
    votingSystem: "fptp",
  },
  {
    _id: "BLR_BRE",
    countryId: "BLR",
    regionType: "state",
    name: "Brest",
    population: 1_350_000,
    // Still the western gateway, now with the Druzhba pipeline and the main
    // freight crossing running through it, but industrially the thinner half of
    // the republic. Food processing and rail.
    gdp: 45_000,
    houseDistricts: 51,
    stateSenateSeats: 0,
    region: "Brest",
    votingSystem: "fptp",
  },
  {
    _id: "BLR_GRO",
    countryId: "BLR",
    regionType: "state",
    name: "Grodno",
    population: 1_020_000,
    // Grodno nitrogen works and Lida, but the oblast stays the most rural and
    // retains the republic's largest Polish minority.
    gdp: 38_000,
    houseDistricts: 39,
    stateSenateSeats: 0,
    region: "Grodno",
    votingSystem: "fptp",
  },
];
export default blrRegions;
