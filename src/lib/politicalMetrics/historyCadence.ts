/**
 * Trend-history cadence and caps.
 *
 * Their own module because the turn phase that writes the series imports the
 * whole engine (mongodb, providers, the metric engine), and the payloads serve
 * the cadence to a CLIENT component so it can label a delta honestly. Importing
 * the turn phase for a number would ship the engine to the browser.
 */

/** Turns between snapshots, national and regional alike. */
export const HISTORY_CADENCE_TURNS = 24;

/** National series cap: 26 docs, so it can afford depth. */
export const HISTORY_MAX_ENTRIES = 365;

/**
 * Region series cap (issue #1322). Lower than the national 365 because there
 * are 237 region docs against 26 national ones; 90 entries at the 24-turn
 * cadence is 2,160 turns of coverage, against a world currently near turn 575.
 */
export const REGION_HISTORY_MAX_ENTRIES = 90;

/** Turns in a game year, matching the statute book's per-year conversion. */
export const TURNS_PER_YEAR = 48;
