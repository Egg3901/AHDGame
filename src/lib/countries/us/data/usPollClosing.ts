/**
 * Final general-election poll closing times for the US presidential night
 * broadcast, in Eastern clock hours on election night (19 = 7:00 PM ET,
 * 24.5 = 12:30 AM ET the next day).
 *
 * Source: the final statewide poll closing time per state as published in the
 * standard network and wire-service election-night schedules (the last
 * precinct to close, so a state split across time zones uses its later zone).
 * Display-only; none of this feeds resolution.
 */

export const US_POLL_CLOSE_ET_HOURS: Readonly<Record<string, number>> = {
  // 7:00 PM
  GA: 19,
  IN: 19,
  KY: 19,
  SC: 19,
  VT: 19,
  VA: 19,
  // 7:30 PM
  NC: 19.5,
  OH: 19.5,
  WV: 19.5,
  // 8:00 PM
  AL: 20,
  CT: 20,
  DE: 20,
  DC: 20,
  FL: 20,
  IL: 20,
  ME: 20,
  MD: 20,
  MA: 20,
  MS: 20,
  MO: 20,
  NH: 20,
  NJ: 20,
  OK: 20,
  PA: 20,
  RI: 20,
  TN: 20,
  // 8:30 PM
  AR: 20.5,
  // 9:00 PM
  AZ: 21,
  CO: 21,
  KS: 21,
  LA: 21,
  MI: 21,
  MN: 21,
  NE: 21,
  NM: 21,
  NY: 21,
  ND: 21,
  SD: 21,
  TX: 21,
  WI: 21,
  WY: 21,
  // 10:00 PM
  IA: 22,
  MT: 22,
  NV: 22,
  UT: 22,
  // 11:00 PM
  CA: 23,
  ID: 23,
  OR: 23,
  WA: 23,
  // Midnight and 1:00 AM
  HI: 24,
  AK: 25,
};

/** First and last closing hours in the table (derived, so edits stay consistent). */
export const FIRST_CLOSE_ET_HOUR = Math.min(...Object.values(US_POLL_CLOSE_ET_HOURS));
export const LAST_CLOSE_ET_HOUR = Math.max(...Object.values(US_POLL_CLOSE_ET_HOURS));

/** Fallback for a unit missing from the table (mid-evening batch). */
export const DEFAULT_CLOSE_ET_HOUR = 21;

/** "ME_CD1" and "NE_CD2" close with their parent state. */
export function pollCloseEtHour(unitId: string): number {
  const stateId = unitId.replace(/_CD\d$/, "");
  return US_POLL_CLOSE_ET_HOURS[stateId] ?? DEFAULT_CLOSE_ET_HOUR;
}
