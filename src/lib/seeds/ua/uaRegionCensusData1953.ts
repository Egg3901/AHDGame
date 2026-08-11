/**
 * Ukraine (Ukrainian SSR) Layer-1 census (1953), one entry per macro-region.
 * ethnicity: ukrainian (titular) / russian / other. Each dim sums 100.
 *
 * SEED INDEPENDENCE - DO NOT DERIVE FROM ANOTHER ERA.
 * Authored for ~1953 directly, keyed to the region `_id` values in
 * uaRegions1953.ts (the same codes the 1979 bundle uses).
 *
 * Key 1953 anchors (vs 1979):
 * - Urbanisation is roughly a third republic-wide against ~61% in 1979, and it
 *   is concentrated almost entirely in the Donbas and the Dnieper belt. The
 *   west and Podolia are village societies with market towns.
 * - Education is thin and rural. Compulsory seven-year schooling was only
 *   restored across the republic after the war and higher education sits at
 *   1-3% of adults; the technical and trade (FZO/remeslennye) streams that
 *   staff the mines and mills are being built out under the Fifth Five-Year
 *   Plan, so vocational shares are highest exactly where the plan is spending.
 * - Age carries two scars, not one: the war removed a large slice of the mid
 *   and mature cohorts and skewed them female, and the 1946-47 famine cut into
 *   the youngest. The young share is still high because the postwar recovery
 *   in births is under way, but it is not the clean baby boom Poland has.
 * - Income is administratively compressed and the 1947 currency reform wiped
 *   what private savings the war had left, so `high` is a rounding error
 *   everywhere.
 * - Ethnicity: the 1959 census (the nearest hard count) gives 76.8% Ukrainian,
 *   16.9% Russian. The Russian share is a function of industry - Donbas is
 *   close to evenly split and the Dnieper belt is a quarter Russian, because
 *   cadre and labour recruitment ran along the coal and steel. The west is
 *   overwhelmingly Ukrainian and would be more so were it not for the
 *   Transcarpathian Hungarians and Bukovinian Romanians in `other`; its Poles
 *   were transferred out in 1944-46 and its Jewish population was destroyed.
 *   In the south `other` carries the Bessarabian Bulgarians, Moldovans and
 *   the Odesa Greeks - the Crimean Tatars had been deported in 1944, and in
 *   any case Crimea is still an RSFSR oblast until February 1954.
 */
export const uaRegionCensusData1953 = {
  UKR_KYI: {
    // Republican capital plus the Right Bank countryside: one big city in a
    // large agrarian surround, so the region reads far more rural than Kyiv
    // itself does.
    ethnicity: { ukrainian: 89, russian: 8, other: 3 },
    age: { young: 31, mid: 26, mature: 24, senior: 19 },
    education: { primary_or_below: 70, secondary: 20, vocational: 8, university: 2 },
    income: { low: 50, middle: 48, high: 2 },
    urbanization: { urban: 32, suburban: 11, rural: 57 },
  },
  UKR_WES: {
    // Galicia, Volhynia, Transcarpathia, Bukovina: annexed 1939-45, Greek
    // Catholic until the church's forced dissolution in 1946, and the last
    // corner of the USSR with an armed insurgency inside the seed's decade.
    // Poorest, most rural, thinnest schooling.
    ethnicity: { ukrainian: 88, russian: 5, other: 7 },
    age: { young: 34, mid: 27, mature: 22, senior: 17 }, // highest fertility in the republic
    education: { primary_or_below: 82, secondary: 13, vocational: 4, university: 1 },
    income: { low: 64, middle: 35, high: 1 },
    urbanization: { urban: 20, suburban: 9, rural: 71 },
  },
  UKR_POD: {
    // Sugar beet and grain, no heavy industry, no in-migration to speak of:
    // the most ethnically titular region and the second poorest.
    ethnicity: { ukrainian: 92, russian: 4, other: 4 },
    age: { young: 32, mid: 26, mature: 23, senior: 19 },
    education: { primary_or_below: 80, secondary: 15, vocational: 4, university: 1 },
    income: { low: 60, middle: 38, high: 2 },
    urbanization: { urban: 22, suburban: 9, rural: 69 },
  },
  UKR_DON: {
    // Coal. Already majority urban in 1953, the most Russian region in the
    // republic, and the one place where a working-class household can out-earn
    // a Kyiv office. Miners' wages and rations were protected through the
    // reconstruction at the countryside's expense.
    ethnicity: { ukrainian: 55, russian: 42, other: 3 },
    age: { young: 28, mid: 29, mature: 25, senior: 18 }, // labour in-migration fattens the mid cohort
    education: { primary_or_below: 62, secondary: 21, vocational: 15, university: 2 },
    income: { low: 34, middle: 62, high: 4 },
    urbanization: { urban: 62, suburban: 14, rural: 24 },
  },
  UKR_DNI: {
    // Kryvyi Rih ore, Zaporizhzhia and Dnipropetrovsk metallurgy, DniproHES
    // back on line since 1950. Second most urban, second most Russian, and the
    // largest single block of plan investment in the republic.
    ethnicity: { ukrainian: 74, russian: 23, other: 3 },
    age: { young: 30, mid: 28, mature: 24, senior: 18 },
    education: { primary_or_below: 66, secondary: 20, vocational: 12, university: 2 },
    income: { low: 40, middle: 57, high: 3 },
    urbanization: { urban: 52, suburban: 13, rural: 35 },
  },
  UKR_SOU: {
    // Odesa, Mykolaiv and Kherson: ports, shipyards and a farming steppe
    // behind them. Urban where the ports are, deeply rural everywhere else.
    ethnicity: { ukrainian: 63, russian: 29, other: 8 },
    age: { young: 30, mid: 27, mature: 24, senior: 19 },
    education: { primary_or_below: 68, secondary: 21, vocational: 9, university: 2 },
    income: { low: 46, middle: 51, high: 3 },
    urbanization: { urban: 40, suburban: 12, rural: 48 },
  },
};
export default uaRegionCensusData1953;
