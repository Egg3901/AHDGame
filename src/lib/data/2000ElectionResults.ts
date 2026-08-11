/**
 * 2000 US Presidential Election Results (Gore vs Bush)
 * Margin = Gore % − Bush % (positive = Gore won, negative = Bush won).
 *
 * Source: Dave Leip's Atlas of U.S. Presidential Elections, Wikipedia.
 * Signs are exact (FL recorded as Bush +0.01 — the 537-vote margin). Several
 * states were sub-1-pt (FL, IA, NM, OR, WI) — magnitudes rounded; spot-check.
 *
 * Bush won 271 EV / 30 states; Gore won 266 EV / 20 states + DC.
 *
 * Used for the 1999-default preset's state-lean calibration in
 * `statePartyOrg.ts`. Same shape as `ELECTION_2020_MARGIN`.
 */
export const ELECTION_2000_MARGIN: Record<string, number> = {
  AL: -14.9, // Bush 56.5, Gore 41.6
  AK: -31.0, // Bush 58.6, Gore 27.7
  AZ: -6.3, // Bush 51.0, Gore 44.7
  AR: -5.4, // Bush 51.3, Gore 45.9
  CA: 11.8, // Gore 53.4, Bush 41.7
  CO: -8.4, // Bush 50.8, Gore 42.4
  CT: 17.5, // Gore 55.9, Bush 38.4
  DE: 13.1, // Gore 55.0, Bush 41.9
  DC: 76.2, // Gore 85.2, Bush 9.0
  FL: -0.01, // Bush 48.85, Gore 48.84 (537 votes)
  GA: -11.7, // Bush 54.7, Gore 43.0
  HI: 18.3, // Gore 55.8, Bush 37.5
  ID: -39.5, // Bush 67.2, Gore 27.6
  IL: 12.0, // Gore 54.6, Bush 42.6
  IN: -15.7, // Bush 56.6, Gore 41.0
  IA: 0.3, // Gore 48.5, Bush 48.2
  KS: -20.8, // Bush 58.0, Gore 37.2
  KY: -15.1, // Bush 56.5, Gore 41.4
  LA: -7.7, // Bush 52.6, Gore 44.9
  ME: 5.1, // Gore 49.1, Bush 44.0
  MD: 16.2, // Gore 56.6, Bush 40.3
  MA: 27.3, // Gore 59.8, Bush 32.5
  MI: 5.1, // Gore 51.3, Bush 46.1
  MN: 2.4, // Gore 47.9, Bush 45.5
  MS: -16.9, // Bush 57.6, Gore 40.7
  MO: -3.3, // Bush 50.4, Gore 47.1
  MT: -25.1, // Bush 58.4, Gore 33.4
  NE: -29.0, // Bush 62.2, Gore 33.3
  NV: -3.5, // Bush 49.5, Gore 46.0
  NH: -1.3, // Bush 48.1, Gore 46.8
  NJ: 15.8, // Gore 56.1, Bush 40.3
  NM: 0.1, // Gore 47.9, Bush 47.8 (366 votes)
  NY: 25.0, // Gore 60.2, Bush 35.2
  NC: -12.8, // Bush 56.0, Gore 43.2
  ND: -27.6, // Bush 60.7, Gore 33.1
  OH: -3.5, // Bush 50.0, Gore 46.5
  OK: -21.9, // Bush 60.3, Gore 38.4
  OR: 0.4, // Gore 47.0, Bush 46.5
  PA: 4.2, // Gore 50.6, Bush 46.4
  RI: 29.1, // Gore 61.0, Bush 31.9
  SC: -16.0, // Bush 56.8, Gore 40.9
  SD: -22.7, // Bush 60.3, Gore 37.6
  TN: -3.9, // Bush 51.1, Gore 47.3
  TX: -21.3, // Bush 59.3, Gore 38.0
  UT: -40.5, // Bush 66.8, Gore 26.3
  VT: 9.9, // Gore 50.6, Bush 40.7
  VA: -8.0, // Bush 52.5, Gore 44.4
  WA: 5.6, // Gore 50.2, Bush 44.6
  WV: -6.3, // Bush 51.9, Gore 45.6
  WI: 0.2, // Gore 47.8, Bush 47.6
  WY: -40.1, // Bush 67.8, Gore 27.7
};
