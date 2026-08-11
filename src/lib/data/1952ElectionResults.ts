/**
 * 1952 US Presidential Election Results (Stevenson vs Eisenhower)
 * Margin = Stevenson % − Eisenhower % (positive = Stevenson won, negative =
 * Eisenhower won). Same shape and sign convention as `ELECTION_2020_MARGIN`.
 *
 * Source: Dave Leip's Atlas of U.S. Presidential Elections, Wikipedia.
 * Eisenhower won 442 EV / 39 states (55.2% national); Stevenson won 89 EV /
 * 9 states (44.3%), all in the Solid South (AL, AR, GA, KY, LA, MS, NC, SC,
 * WV). Signs (who carried each state) are exact; magnitudes are rounded
 * finals. Close states worth noting: KY (Stevenson by ~0.1), SC (Stevenson by
 * ~1.4 — Eisenhower's vote split across a Republican line and "Independents
 * for Eisenhower" electors), TN and MO (Eisenhower by < 2).
 *
 * AK and HI were still territories in 1952 and DC had no electoral votes
 * until 1961, so none of the three appear here.
 *
 * Used for the 1953-default preset's state-lean calibration in
 * `statePartyOrg.ts` (see PRESET_MARGINS) and the seed-readiness audit's
 * election baseline (`electionBaselines.ts`).
 */
export const ELECTION_1952_MARGIN: Record<string, number> = {
  AL: 29.9, // Stevenson 64.9, Eisenhower 35.0
  AZ: -16.6, // Eisenhower 58.3, Stevenson 41.7
  AR: 12.1, // Stevenson 55.9, Eisenhower 43.8
  CA: -13.6, // Eisenhower 56.3, Stevenson 42.7
  CO: -21.3, // Eisenhower 60.3, Stevenson 39.0
  CT: -11.8, // Eisenhower 55.7, Stevenson 43.9
  DE: -3.9, // Eisenhower 51.8, Stevenson 47.9
  FL: -10.0, // Eisenhower 55.0, Stevenson 45.0
  GA: 39.4, // Stevenson 69.7, Eisenhower 30.3
  ID: -31.0, // Eisenhower 65.4, Stevenson 34.4
  IL: -9.9, // Eisenhower 54.8, Stevenson 44.9
  IN: -17.1, // Eisenhower 58.1, Stevenson 41.0
  IA: -28.2, // Eisenhower 63.8, Stevenson 35.6
  KS: -38.3, // Eisenhower 68.8, Stevenson 30.5
  KY: 0.1, // Stevenson 49.9, Eisenhower 49.8 — decided by ~700 votes
  LA: 5.8, // Stevenson 52.9, Eisenhower 47.1
  ME: -32.2, // Eisenhower 66.0, Stevenson 33.8
  MD: -11.6, // Eisenhower 55.4, Stevenson 43.8
  MA: -8.7, // Eisenhower 54.2, Stevenson 45.5
  MI: -11.4, // Eisenhower 55.4, Stevenson 44.0
  MN: -11.2, // Eisenhower 55.3, Stevenson 44.1
  MS: 20.8, // Stevenson 60.4, Eisenhower 39.6
  MO: -1.6, // Eisenhower 50.7, Stevenson 49.1
  MT: -19.3, // Eisenhower 59.4, Stevenson 40.1
  NE: -38.3, // Eisenhower 69.2, Stevenson 30.9
  NV: -22.8, // Eisenhower 61.4, Stevenson 38.6
  NH: -21.8, // Eisenhower 60.9, Stevenson 39.1
  NJ: -14.8, // Eisenhower 56.8, Stevenson 42.0
  NM: -11.1, // Eisenhower 55.4, Stevenson 44.3
  NY: -11.9, // Eisenhower 55.5, Stevenson 43.6
  NC: 7.8, // Stevenson 53.9, Eisenhower 46.1
  ND: -42.6, // Eisenhower 71.0, Stevenson 28.4
  OH: -13.6, // Eisenhower 56.8, Stevenson 43.2
  OK: -9.2, // Eisenhower 54.6, Stevenson 45.4
  OR: -21.6, // Eisenhower 60.5, Stevenson 38.9
  PA: -5.8, // Eisenhower 52.7, Stevenson 46.9
  RI: -1.8, // Eisenhower 50.9, Stevenson 49.0
  SC: 1.4, // Stevenson 50.7, Eisenhower slates 49.3 (R line + independent electors)
  SD: -38.6, // Eisenhower 69.3, Stevenson 30.7
  TN: -0.3, // Eisenhower 50.0, Stevenson 49.7
  TX: -6.4, // Eisenhower 53.1, Stevenson 46.7
  UT: -17.8, // Eisenhower 58.9, Stevenson 41.1
  VT: -43.3, // Eisenhower 71.5, Stevenson 28.2
  VA: -12.9, // Eisenhower 56.3, Stevenson 43.4
  WA: -9.6, // Eisenhower 54.3, Stevenson 44.7
  WV: 3.8, // Stevenson 51.9, Eisenhower 48.1
  WI: -22.3, // Eisenhower 61.0, Stevenson 38.7
  WY: -25.6, // Eisenhower 62.7, Stevenson 37.1
};

export default ELECTION_1952_MARGIN;
