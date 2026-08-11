/**
 * Byelorussian SSR Layer-1 census (1953), one entry per oblast. Each dim sums
 * to 100. ethnicity: belarusian (titular) / russian / other.
 *
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Authored for ~1953 directly, keyed to the region `_id` in blrRegions1953.ts
 * (the `BLR_` codes from public/blr-regions.json). The census keys are what
 * `buildModelRegionDemographics` stamps onto the generated `stateDemographics`
 * rows, and the seed config's per-region metric overrides key off the same ids,
 * so a mismatched key silently leaves a region with no data at all.
 *
 * Key 1953 anchors (vs 1979):
 * - Byelorussia was the most devastated republic of the war: roughly a quarter
 *   of its population dead and the prewar level not regained until about 1970.
 *   Urbanisation is therefore far below the 1979 figure — the republic is a
 *   countryside with a rebuilding capital, not the machine-building republic it
 *   becomes. Only Minsk is anywhere near a third urban, and that is because the
 *   city is a building site absorbing labour.
 * - Education: the adult stock is thin and rural. The technical schooling that
 *   later staffs MAZ, MTZ and the Polatsk refinery is only being founded, so
 *   the vocational stream is small everywhere and smallest in the west, where
 *   the pre-1939 Polish school system was dismantled and not yet replaced.
 * - Age: the mid cohort is the one the war removed, so it reads unusually thin
 *   against a large postwar young cohort.
 * - Ethnicity: the Russian and Russian-speaking cadre in-migration that lifts
 *   the Russian share to ~12% by 1979 is only starting, and it lands on the
 *   administrative capital and the industrial east first. The western oblasts
 *   annexed in 1939 keep a large Polish population (`other`), and the Jewish
 *   communities that made up much of prewar urban Byelorussia were destroyed in
 *   the Holocaust, which is why `other` falls sharply in the east but stays
 *   high in Grodno and Brest.
 * - The western oblasts also remember pre-1939 Polish smallholding and the
 *   anti-Soviet partisan resistance there is only just being extinguished, so
 *   they read poorer, more rural and more religious than the east.
 */
export const blrRegionCensusData1953 = {
  BLR_MIN: {
    // Capital oblast: an ~80% destroyed city being rebuilt, pulling in Russian
    // cadre, engineers and construction labour from across the union.
    ethnicity: { belarusian: 78, russian: 12, other: 10 },
    age: { young: 32, mid: 27, mature: 23, senior: 18 }, // in-migration skews young
    education: { primary_or_below: 66, secondary: 22, vocational: 9, university: 3 },
    income: { low: 48, middle: 49, high: 3 },
    urbanization: { urban: 34, suburban: 12, rural: 54 },
  },
  BLR_HOM: {
    // Gomel: timber, machine tools and the Dnieper trade; the second-most
    // industrial oblast and the second-largest Russian in-migration target.
    ethnicity: { belarusian: 82, russian: 8, other: 10 },
    age: { young: 31, mid: 26, mature: 24, senior: 19 },
    education: { primary_or_below: 73, secondary: 19, vocational: 6, university: 2 },
    income: { low: 55, middle: 43, high: 2 },
    urbanization: { urban: 27, suburban: 10, rural: 63 },
  },
  BLR_VIT: {
    // Vitebsk: flax, timber and textiles, fought over twice. Prewar Vitebsk was
    // heavily Jewish, so the `other` share collapsed and the titular share rose.
    ethnicity: { belarusian: 83, russian: 9, other: 8 },
    age: { young: 30, mid: 25, mature: 25, senior: 20 }, // hardest-hit mid cohort
    education: { primary_or_below: 74, secondary: 18, vocational: 6, university: 2 },
    income: { low: 57, middle: 41, high: 2 },
    urbanization: { urban: 25, suburban: 10, rural: 65 },
  },
  BLR_MOG: {
    // Mogilev: light industry and grain; plant evacuated eastward in the war has
    // only partly come back, so it reads as the plainest of the eastern oblasts.
    ethnicity: { belarusian: 85, russian: 8, other: 7 },
    age: { young: 31, mid: 26, mature: 24, senior: 19 },
    education: { primary_or_below: 75, secondary: 18, vocational: 5, university: 2 },
    income: { low: 58, middle: 40, high: 2 },
    urbanization: { urban: 24, suburban: 10, rural: 66 },
  },
  BLR_BRE: {
    // Brest: Polish until 1939, agrarian, and the union's western rail door.
    // The border traffic is state business, not local prosperity.
    ethnicity: { belarusian: 84, russian: 3, other: 13 }, // Polish minority
    age: { young: 34, mid: 27, mature: 22, senior: 17 }, // highest rural fertility
    education: { primary_or_below: 80, secondary: 15, vocational: 4, university: 1 },
    income: { low: 62, middle: 37, high: 1 },
    urbanization: { urban: 20, suburban: 9, rural: 71 },
  },
  BLR_GRO: {
    // Grodno: also pre-1939 Poland, the most agrarian and most Catholic oblast,
    // with the republic's largest surviving Polish minority.
    ethnicity: { belarusian: 74, russian: 3, other: 23 }, // largest Polish share
    age: { young: 34, mid: 27, mature: 22, senior: 17 },
    education: { primary_or_below: 82, secondary: 14, vocational: 3, university: 1 },
    income: { low: 64, middle: 35, high: 1 },
    urbanization: { urban: 19, suburban: 9, rural: 72 },
  },
};
export default blrRegionCensusData1953;
