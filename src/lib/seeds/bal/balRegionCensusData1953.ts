/**
 * Baltic republics Layer-1 census (1953), one entry per republic.
 * ethnicity: baltic (the republic's own titular nation) / russian / other.
 * Each dimension sums to 100.
 *
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Authored for ~1953 directly, keyed to the region ids in balRegions1953.ts.
 *
 * ETHNICITY IS THE POINT. Everywhere else in the bloc the ethnic split is
 * texture; here it is the central political fact of the country. `baltic` is
 * the titular nation of that republic and nothing else — an Estonian living in
 * Riga counts as `other` in BAL_LVA, because the political question the seed
 * has to be able to answer is "does the titular nation still hold a majority
 * in its own republic", not "how many Balts are there in total". Shares are
 * read back from the 1959 all-Union census, which is the first hard count
 * after the war, and nudged toward the titular side because the heaviest
 * in-migration falls in the second half of the 1950s:
 *   - Estonia: 1959 gives Estonians 74.6% and Russians 20.1%. Six years
 *     earlier the Narva and Kohtla-Jarve shale towns were only starting to be
 *     resettled with imported Russian labour, so 80/16/4.
 *   - Latvia: 1959 gives Latvians 62.0% and Russians 26.6%, the worst position
 *     of the three. Riga's war losses, the flight to Sweden and Germany in
 *     1944, and the Priboi deportations all fell hardest here, and the city's
 *     factories were staffed from outside. 65/24/11, with `other` carrying the
 *     large Belarusian, Polish and Ukrainian populations of Latgale.
 *   - Lithuania: 1959 gives Lithuanians 79.3% and Russians only 8.5%. Lithuania
 *     absorbed far less in-migration, partly because it had less new heavy
 *     industry to staff, so the titular nation is not under threat. Its
 *     minority question is the Polish population of the Vilnius region, which
 *     sits in `other` at 12.
 *
 * Other dimensions:
 * - Education. The interwar republics ran real school systems for twenty years
 *   and the stock survives, so `primary_or_below` sits well below the rest of
 *   the bloc and university attainment is roughly double Bulgaria's. Latvia and
 *   Estonia lead; Lithuania, which was the poorest and most rural of the three
 *   before the war, trails.
 * - Age. The mid cohort is thin in all three: war deaths, the 1944 westward
 *   flight, and the March 1949 deportations all removed working-age adults, and
 *   the Forest Brothers casualties came out of the same cohort.
 * - Urbanisation. Tallinn and Riga are substantial cities in 1953 and drag
 *   their republics above the Union average; Lithuania is still a countryside
 *   of smallholdings only just collectivised, and reads accordingly.
 * - Income. `high` is near-nominal everywhere in a planned economy; the
 *   informative movement is the low/middle boundary, and Estonia sits best.
 */
export const balRegionCensusData1953 = {
  BAL_LTU: {
    // Most agrarian and most Catholic of the three; the Polish minority of the
    // Vilnius region sits in `other`, and Russian in-migration is slight.
    ethnicity: { baltic: 80, russian: 8, other: 12 },
    age: { young: 30, mid: 26, mature: 24, senior: 20 }, // higher rural fertility
    education: { primary_or_below: 62, secondary: 24, vocational: 11, university: 3 },
    income: { low: 48, middle: 48, high: 4 },
    urbanization: { urban: 32, suburban: 10, rural: 58 },
  },
  BAL_LVA: {
    // Riga's electronics and machine-building (VEF, RVR) make this the most
    // industrial republic, and the one where the titular share is falling
    // fastest. `other` carries Latgale's Belarusians, Poles and Ukrainians.
    ethnicity: { baltic: 65, russian: 24, other: 11 },
    age: { young: 24, mid: 27, mature: 27, senior: 22 }, // thinnest mid cohort of the three
    education: { primary_or_below: 51, secondary: 29, vocational: 15, university: 5 },
    income: { low: 37, middle: 57, high: 6 },
    urbanization: { urban: 48, suburban: 13, rural: 39 },
  },
  BAL_EST: {
    // Kohtla-Jarve oil shale plus the highest living standard in the USSR.
    // Finnish-language radio already leaks across the gulf, which is why the
    // press-freedom metric reads a shade better here than in the other two.
    ethnicity: { baltic: 80, russian: 16, other: 4 },
    age: { young: 24, mid: 27, mature: 27, senior: 22 },
    education: { primary_or_below: 48, secondary: 30, vocational: 16, university: 6 },
    income: { low: 33, middle: 60, high: 7 },
    urbanization: { urban: 50, suburban: 13, rural: 37 },
  },
};
export default balRegionCensusData1953;
