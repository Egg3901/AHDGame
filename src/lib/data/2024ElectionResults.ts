/**
 * 2024 US Presidential Election Results (Harris vs Trump)
 * Margin = Harris % − Trump % (positive = Harris won, negative = Trump won).
 *
 * Source: certified state results, Dave Leip's Atlas / Wikipedia.
 * Signs exact: Trump swept all seven swing states (AZ, GA, MI, NV, NC, PA, WI).
 * Magnitudes rounded finals; spot-check the swing-state cells (all < 3.5 pts).
 * NOTE: ME and NE split by district; this table records the statewide margin
 * only (district splits are handled separately in seat allocation).
 *
 * Trump won 312 EV / 31 states; Harris won 226 EV / 19 states + DC.
 *
 * Used for the 2023-default preset's state-lean calibration in
 * `statePartyOrg.ts`. Same shape as `ELECTION_2020_MARGIN`.
 */
export const ELECTION_2024_MARGIN: Record<string, number> = {
  AL: -30.5, // Trump 64.8, Harris 34.3
  AK: -13.1, // Trump 54.5, Harris 41.4
  AZ: -5.5, // Trump 52.2, Harris 46.7
  AR: -31.6, // Trump 64.2, Harris 32.6
  CA: 20.2, // Harris 58.5, Trump 38.3
  CO: 11.0, // Harris 54.2, Trump 43.2
  CT: 14.5, // Harris 56.4, Trump 41.9
  DE: 15.0, // Harris 56.6, Trump 41.6
  DC: 85.4, // Harris 92.5, Trump 6.6
  FL: -13.1, // Trump 56.1, Harris 43.0
  GA: -2.2, // Trump 50.7, Harris 48.5
  HI: 23.5, // Harris 60.6, Trump 37.1
  ID: -36.8, // Trump 66.9, Harris 30.1
  IL: 11.0, // Harris 54.4, Trump 43.4
  IN: -19.0, // Trump 58.6, Harris 39.6
  IA: -13.2, // Trump 55.7, Harris 42.5
  KS: -16.1, // Trump 57.0, Harris 40.9
  KY: -30.5, // Trump 64.6, Harris 34.1
  LA: -22.0, // Trump 60.0, Harris 38.0
  ME: 6.9, // Harris 52.0, Trump 45.1 (statewide)
  MD: 29.0, // Harris 62.6, Trump 33.6
  MA: 25.4, // Harris 61.3, Trump 35.9
  MI: -1.4, // Trump 49.7, Harris 48.3
  MN: 4.3, // Harris 50.9, Trump 46.7
  MS: -23.5, // Trump 60.9, Harris 37.4
  MO: -18.5, // Trump 58.5, Harris 40.0
  MT: -20.0, // Trump 58.4, Harris 38.5
  NE: -20.5, // Trump 59.6, Harris 39.1 (statewide)
  NV: -3.1, // Trump 50.6, Harris 47.5
  NH: 2.8, // Harris 50.8, Trump 48.0
  NJ: 5.9, // Harris 52.0, Trump 46.1
  NM: 6.1, // Harris 51.9, Trump 45.8
  NY: 12.6, // Harris 55.9, Trump 43.3
  NC: -3.2, // Trump 51.0, Harris 47.8
  ND: -36.4, // Trump 67.2, Harris 30.8
  OH: -11.2, // Trump 55.1, Harris 43.9
  OK: -33.5, // Trump 66.2, Harris 31.9
  OR: 14.0, // Harris 55.4, Trump 41.3
  PA: -1.7, // Trump 50.4, Harris 48.7
  RI: 14.0, // Harris 55.6, Trump 41.6
  SC: -18.0, // Trump 58.2, Harris 40.4
  SD: -29.5, // Trump 63.4, Harris 34.2
  TN: -29.0, // Trump 64.2, Harris 35.0
  TX: -13.7, // Trump 56.1, Harris 42.4
  UT: -21.5, // Trump 59.4, Harris 37.8
  VT: 32.0, // Harris 64.4, Trump 32.4
  VA: 5.8, // Harris 51.8, Trump 46.0
  WA: 18.8, // Harris 57.9, Trump 39.0
  WV: -41.9, // Trump 70.0, Harris 28.1
  WI: -0.9, // Trump 49.6, Harris 48.7
  WY: -45.9, // Trump 71.6, Harris 25.7
};
