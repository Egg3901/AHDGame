/**
 * 1988 US Presidential Election Results (Bush vs Dukakis)
 * Margin = Dukakis % − Bush % (positive = Dukakis won, negative = Bush won).
 *
 * Source: Dave Leip's Atlas of U.S. Presidential Elections, Wikipedia.
 *
 * Bush won 426 EV / 40 states, Dukakis won 111 EV / 10 states + DC.
 * Used for the 1991-default preset's state-lean calibration in
 * `statePartyOrg.ts` (which seeds initial Org from `calculateInitialOrg`).
 *
 * Same shape as `ELECTION_2020_MARGIN` so `marginToLean` works against
 * either constant — only the data set changes per preset.
 */
export const ELECTION_1988_MARGIN: Record<string, number> = {
  AL: -19.3, // Bush 59.2, Dukakis 39.9
  AK: -23.3, // Bush 59.6, Dukakis 36.3
  AZ: -21.3, // Bush 60.0, Dukakis 38.7
  AR: -14.2, // Bush 56.4, Dukakis 42.2
  CA: -3.5, // Bush 51.1, Dukakis 47.6
  CO: -7.8, // Bush 53.1, Dukakis 45.3
  CT: -5.1, // Bush 52.0, Dukakis 46.9
  DE: -12.4, // Bush 55.9, Dukakis 43.5
  DC: 68.4, // Dukakis 82.7, Bush 14.3
  FL: -22.4, // Bush 60.9, Dukakis 38.5
  GA: -20.3, // Bush 59.8, Dukakis 39.5
  HI: 9.5, // Dukakis 54.3, Bush 44.8
  ID: -26.1, // Bush 62.1, Dukakis 36.0
  IL: -2.1, // Bush 50.7, Dukakis 48.6
  IN: -20.1, // Bush 59.8, Dukakis 39.7
  IA: 10.2, // Dukakis 54.7, Bush 44.5
  KS: -13.4, // Bush 56.0, Dukakis 42.6
  KY: -11.6, // Bush 55.5, Dukakis 43.9
  LA: -10.2, // Bush 54.3, Dukakis 44.1
  ME: -11.4, // Bush 55.3, Dukakis 43.9
  MD: -2.2, // Bush 51.1, Dukakis 48.9
  MA: 7.9, // Dukakis 53.2, Bush 45.4
  MI: -7.9, // Bush 53.6, Dukakis 45.7
  MN: 7.0, // Dukakis 52.9, Bush 45.9
  MS: -20.8, // Bush 59.9, Dukakis 39.1
  MO: -4.0, // Bush 51.8, Dukakis 47.8
  MT: -5.9, // Bush 52.1, Dukakis 46.2
  NE: -20.9, // Bush 60.1, Dukakis 39.2
  NV: -21.0, // Bush 58.9, Dukakis 37.9
  NH: -26.2, // Bush 62.5, Dukakis 36.3
  NJ: -13.6, // Bush 56.2, Dukakis 42.6
  NM: -5.0, // Bush 51.9, Dukakis 46.9
  NY: 4.1, // Dukakis 51.6, Bush 47.5
  NC: -16.3, // Bush 58.0, Dukakis 41.7
  ND: -13.0, // Bush 56.0, Dukakis 43.0
  OH: -10.8, // Bush 55.0, Dukakis 44.2
  OK: -16.6, // Bush 57.9, Dukakis 41.3
  OR: 4.7, // Dukakis 51.3, Bush 46.6
  PA: -2.3, // Bush 50.7, Dukakis 48.4
  RI: 11.7, // Dukakis 55.6, Bush 43.9
  SC: -23.9, // Bush 61.5, Dukakis 37.6
  SD: -6.3, // Bush 52.8, Dukakis 46.5
  TN: -16.4, // Bush 57.9, Dukakis 41.5
  TX: -12.7, // Bush 56.0, Dukakis 43.3
  UT: -34.2, // Bush 66.2, Dukakis 32.0
  VT: -3.5, // Bush 51.1, Dukakis 47.6
  VA: -20.5, // Bush 59.7, Dukakis 39.2
  WA: 1.6, // Dukakis 50.1, Bush 48.5
  WV: 4.7, // Dukakis 52.2, Bush 47.5
  WI: 3.6, // Dukakis 51.4, Bush 47.8
  WY: -22.5, // Bush 60.5, Dukakis 38.0
};
