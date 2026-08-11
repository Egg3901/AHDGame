/**
 * 1980 US Presidential Election Results (Carter vs Reagan)
 * Margin = Carter % − Reagan % (positive = Carter won, negative = Reagan won).
 *
 * Source: Dave Leip's Atlas of U.S. Presidential Elections, Wikipedia.
 * NOTE: 1980 had a significant third-party vote (John Anderson ≈ 6.6%
 * nationally), so the Carter−Reagan two-candidate margin is narrower than the
 * winner's share. Signs (who carried each state) are exact; magnitudes are
 * rounded finals and worth a spot-check on the close states (AL, AR, MA, MS,
 * SC, TN, KY all decided by < 2 pts).
 *
 * Reagan won 489 EV / 44 states; Carter won 49 EV / 6 states + DC
 * (GA, HI, MD, MN, RI, WV, DC).
 *
 * Used for the 1979-default preset's state-lean calibration in
 * `statePartyOrg.ts`. Same shape as `ELECTION_2020_MARGIN`.
 */
export const ELECTION_1980_MARGIN: Record<string, number> = {
  AL: -1.3, // Reagan 48.8, Carter 47.4
  AK: -27.9, // Reagan 54.3, Carter 26.4
  AZ: -32.4, // Reagan 60.6, Carter 28.2
  AR: -0.6, // Reagan 48.1, Carter 47.5
  CA: -16.8, // Reagan 52.7, Carter 35.9
  CO: -24.0, // Reagan 55.1, Carter 31.1
  CT: -9.7, // Reagan 48.2, Carter 38.5
  DE: -2.4, // Reagan 47.2, Carter 44.8
  DC: 61.5, // Carter 74.9, Reagan 13.4
  FL: -17.0, // Reagan 55.5, Carter 38.5
  GA: 14.8, // Carter 55.8, Reagan 41.0
  HI: 1.9, // Carter 44.8, Reagan 42.9
  ID: -41.3, // Reagan 66.5, Carter 25.2
  IL: -8.0, // Reagan 49.7, Carter 41.7
  IN: -18.3, // Reagan 56.0, Carter 37.7
  IA: -12.7, // Reagan 51.3, Carter 38.6
  KS: -24.6, // Reagan 57.9, Carter 33.3
  KY: -1.5, // Reagan 49.1, Carter 47.6
  LA: -5.5, // Reagan 51.2, Carter 45.7
  ME: -3.3, // Reagan 45.6, Carter 42.3
  MD: 2.9, // Carter 47.1, Reagan 44.2
  MA: -0.2, // Reagan 41.9, Carter 41.7
  MI: -6.5, // Reagan 49.0, Carter 42.5
  MN: 3.9, // Carter 46.5, Reagan 42.6
  MS: -1.3, // Reagan 49.4, Carter 48.1
  MO: -6.8, // Reagan 51.2, Carter 44.4
  MT: -24.4, // Reagan 56.8, Carter 32.4
  NE: -39.5, // Reagan 65.5, Carter 26.0
  NV: -35.6, // Reagan 62.5, Carter 26.9
  NH: -29.3, // Reagan 57.7, Carter 28.4
  NJ: -13.4, // Reagan 52.0, Carter 38.6
  NM: -18.3, // Reagan 55.0, Carter 36.7
  NY: -2.7, // Reagan 46.7, Carter 44.0
  NC: -2.1, // Reagan 49.3, Carter 47.2
  ND: -37.9, // Reagan 64.2, Carter 26.3
  OH: -10.6, // Reagan 51.5, Carter 40.9
  OK: -25.5, // Reagan 60.5, Carter 35.0
  OR: -9.6, // Reagan 48.3, Carter 38.7
  PA: -7.1, // Reagan 49.6, Carter 42.5
  RI: 10.5, // Carter 47.7, Reagan 37.2
  SC: -1.3, // Reagan 49.4, Carter 48.1
  SD: -28.8, // Reagan 60.5, Carter 31.7
  TN: -0.3, // Reagan 48.7, Carter 48.4
  TX: -13.9, // Reagan 55.3, Carter 41.4
  UT: -52.2, // Reagan 72.8, Carter 20.6
  VT: -6.0, // Reagan 44.4, Carter 38.4
  VA: -12.7, // Reagan 53.0, Carter 40.3
  WA: -12.4, // Reagan 49.7, Carter 37.3
  WV: 4.5, // Carter 49.8, Reagan 45.3
  WI: -4.7, // Reagan 47.9, Carter 43.2
  WY: -34.6, // Reagan 62.6, Carter 28.0
};
