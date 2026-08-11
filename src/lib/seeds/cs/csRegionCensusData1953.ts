/**
 * Czechoslovakia Layer-1 census (1953, the Gottwald/Zápotocký years), one entry
 * per region. ethnicity: czech (titular) / slovak / other. Each dim sums 100.
 *
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Authored for ~1953 directly, keyed to the same region codes as the 1979
 * bundle (matching csRegions1953.ts).
 *
 * Key 1953 anchors (vs 1979):
 * - The Czech lands are the bloc's one genuinely industrial society already in
 *   1953 — this is the country the Soviets wanted for its Škoda and Vítkovice
 *   works — so the Bohemia/Slovakia gap is at its widest here. Slovakia is still
 *   overwhelmingly agrarian; its industrialisation is a 1960s-70s project.
 * - The Sudetenland has been emptied by the 1945-46 expulsion of ~3 million
 *   Germans and resettled from the interior, which is why the German remainder in
 *   Bohemia's `other` is small but non-trivial and the region skews young.
 * - Education: a comparatively strong Czech schooling stock by bloc standards,
 *   but the adult population is still mostly primary/vocational; Slovakia lags
 *   sharply. The 1953 currency reform (which triggered the Plzeň revolt) has just
 *   wiped savings, flattening income almost completely.
 * - Ethnicity: Slovakia's Hungarian minority sits in `other`; the 1945-48
 *   reslovakisation and population exchange with Hungary have reduced but not
 *   removed it.
 */
export const csRegionCensusData1953 = {
  CS_PRG: {
    // Prague: administrative and academic centre, the most educated region
    ethnicity: { czech: 96, slovak: 2, other: 2 },
    age: { young: 24, mid: 28, mature: 26, senior: 22 },
    education: { primary_or_below: 44, secondary: 30, vocational: 20, university: 6 },
    income: { low: 26, middle: 66, high: 8 },
    urbanization: { urban: 90, suburban: 8, rural: 2 },
  },
  CS_BOH: {
    // Bohemia: Škoda, Plzeň (the June 1953 currency-reform revolt), resettled Sudetenland
    ethnicity: { czech: 93, slovak: 3, other: 4 },
    age: { young: 27, mid: 28, mature: 25, senior: 20 },
    education: { primary_or_below: 56, secondary: 24, vocational: 18, university: 2 },
    income: { low: 34, middle: 62, high: 4 },
    urbanization: { urban: 48, suburban: 14, rural: 38 },
  },
  CS_MOR: {
    // Moravia-Silesia: Ostrava coal and the Vítkovice ironworks
    ethnicity: { czech: 93, slovak: 4, other: 3 },
    age: { young: 29, mid: 28, mature: 24, senior: 19 },
    education: { primary_or_below: 60, secondary: 22, vocational: 16, university: 2 },
    income: { low: 36, middle: 60, high: 4 },
    urbanization: { urban: 44, suburban: 13, rural: 43 },
  },
  CS_SVK: {
    // Slovakia: still a peasant society; Catholic, high-fertility, pre-industrial
    ethnicity: { czech: 3, slovak: 82, other: 15 },
    age: { young: 35, mid: 28, mature: 21, senior: 16 },
    education: { primary_or_below: 74, secondary: 17, vocational: 8, university: 1 },
    income: { low: 54, middle: 44, high: 2 },
    urbanization: { urban: 26, suburban: 10, rural: 64 },
  },
};
export default csRegionCensusData1953;
