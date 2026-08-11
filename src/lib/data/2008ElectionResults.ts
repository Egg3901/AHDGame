/**
 * 2008 US Presidential Election Results (Obama vs McCain)
 * Margin = Obama % − McCain % (positive = Obama won, negative = McCain won).
 *
 * Source: Dave Leip's Atlas of U.S. Presidential Elections, Wikipedia.
 * Signs exact (MO recorded as McCain +0.13, NC as Obama +0.32 — the two
 * closest states). Magnitudes rounded finals; spot-check the sub-1-pt cells.
 *
 * Obama won 365 EV / 28 states + DC; McCain won 173 EV / 22 states.
 *
 * Used for the 2007-default preset's state-lean calibration in
 * `statePartyOrg.ts`. Same shape as `ELECTION_2020_MARGIN`.
 */
export const ELECTION_2008_MARGIN: Record<string, number> = {
  AL: -21.6, // McCain 60.3, Obama 38.7
  AK: -21.5, // McCain 59.4, Obama 37.9
  AZ: -8.5, // McCain 53.6, Obama 45.1
  AR: -19.9, // McCain 58.7, Obama 38.9
  CA: 24.0, // Obama 61.0, McCain 37.0
  CO: 9.0, // Obama 53.7, McCain 44.7
  CT: 22.4, // Obama 60.6, McCain 38.2
  DE: 24.9, // Obama 61.9, McCain 37.0
  DC: 85.9, // Obama 92.5, McCain 6.5
  FL: 2.8, // Obama 51.0, McCain 48.2
  GA: -5.2, // McCain 52.2, Obama 47.0
  HI: 45.3, // Obama 71.9, McCain 26.6
  ID: -25.3, // McCain 61.5, Obama 36.1
  IL: 25.1, // Obama 61.9, McCain 36.8
  IN: 1.0, // Obama 49.9, McCain 48.9
  IA: 9.5, // Obama 53.9, McCain 44.4
  KS: -15.0, // McCain 56.6, Obama 41.7
  KY: -16.2, // McCain 57.4, Obama 41.2
  LA: -18.6, // McCain 58.6, Obama 39.9
  ME: 17.3, // Obama 57.7, McCain 40.4
  MD: 25.4, // Obama 61.9, McCain 36.5
  MA: 25.8, // Obama 61.8, McCain 36.0
  MI: 16.4, // Obama 57.4, McCain 41.0
  MN: 10.2, // Obama 54.1, McCain 43.8
  MS: -13.2, // McCain 56.2, Obama 43.0
  MO: -0.1, // McCain 49.4, Obama 49.3
  MT: -2.4, // McCain 49.5, Obama 47.1
  NE: -14.9, // McCain 56.5, Obama 41.6
  NV: 12.5, // Obama 55.1, McCain 42.7
  NH: 9.6, // Obama 54.1, McCain 44.5
  NJ: 15.5, // Obama 57.3, McCain 41.7
  NM: 15.1, // Obama 56.9, McCain 41.8
  NY: 26.9, // Obama 62.9, McCain 36.0
  NC: 0.3, // Obama 49.7, McCain 49.4
  ND: -8.6, // McCain 53.3, Obama 44.6
  OH: 4.6, // Obama 51.5, McCain 46.9
  OK: -31.3, // McCain 65.6, Obama 34.4
  OR: 16.4, // Obama 56.7, McCain 40.4
  PA: 10.3, // Obama 54.5, McCain 44.2
  RI: 27.8, // Obama 62.9, McCain 35.1
  SC: -9.0, // McCain 53.9, Obama 44.9
  SD: -8.4, // McCain 53.2, Obama 44.7
  TN: -15.1, // McCain 56.9, Obama 41.8
  TX: -11.8, // McCain 55.4, Obama 43.7
  UT: -28.0, // McCain 62.6, Obama 34.4
  VT: 37.0, // Obama 67.5, McCain 30.4
  VA: 6.3, // Obama 52.6, McCain 46.3
  WA: 17.1, // Obama 57.7, McCain 40.5
  WV: -13.1, // McCain 55.7, Obama 42.6
  WI: 13.9, // Obama 56.2, McCain 42.3
  WY: -32.2, // McCain 64.8, Obama 32.5
};
