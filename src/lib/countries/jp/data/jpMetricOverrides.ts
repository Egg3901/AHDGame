import type { MetricEraWindow } from "@/lib/era/metricCatalog";

/**
 * Japan's per-metric departures from the global era catalogue.
 *
 * Moved out of `src/lib/era/metricCatalog.ts`, which now forwards to these.
 * Values and copy unchanged.
 */

/**
 * Nuclear safety becomes a live metric in Japan nine years after it does
 * globally: Tokai came online in 1966, against a global `from: 1957`.
 *
 * ⚠ THE `news` BODY IS PLAYER-FACING COPY. It is shown verbatim when the
 * metric opens, so it follows the project copy rules -- no years in the prose,
 * no em or en dashes, in any language.
 */
export const JP_NUCLEAR_SAFETY_WINDOW: NonNullable<
  NonNullable<MetricEraWindow["countryOverrides"]>["JP"]
> = {
  from: 1966,
  news: {
    title: "Japan Enters the Atomic Age",
    body: "At Tōkai, Japan has stepped into the atomic age of electricity. For a nation hungry for power and technological standing, the reactor is more than a machine; it is a statement that Japan intends to master the industries of the future. Officials in Tokyo speak of energy security, engineering skill, and a modern grid fit for a rising economy.\n\nYet the achievement arrives with solemn questions. In fishing towns, factory districts, and university halls, citizens ask how safety will be proven and who will be trusted to prove it. Nuclear safety has entered Japan's national conversation as both a technical standard and a test of public confidence.",
  },
};

/**
 * Japan's health-coverage band, by year.
 *
 * ⚠ THE 1953 BAND IS WIDER THAN THE MODERN ONE ON PURPOSE. National Health
 * Insurance only became universal in 1961, so a 1953 Japan scored against the
 * modern band would read as a failing state rather than a developing one. From
 * 1979 Japan sits on the same band as everyone else, which is why the last two
 * rows are identical -- that repetition is the signal that the curve has
 * converged, not a copy-paste slip.
 */
export const JP_HEALTH_COVERAGE_BAND: Array<{ year: number; best: number; worst: number }> = [
  { year: 1953, best: 15, worst: 70 }, // normal 40 (NHI universal only in 1961)
  { year: 1979, best: 0, worst: 22 }, // universal since 1961 → modern band
  { year: 2019, best: 0, worst: 22 },
];
