/**
 * 2020 US Presidential Election Results (Biden vs Trump)
 * Margin = Biden % - Trump % (positive = Biden won, negative = Trump won)
 * Source: Dave Leip's Atlas of U.S. Presidential Elections, Wikipedia
 * Used to calibrate demographic-derived state leans so they align with actual 2020 outcomes.
 */
export const ELECTION_2020_MARGIN: Record<string, number> = {
  AL: -25.4, // Trump 62.0, Biden 36.6
  AK: -10.0, // Trump 52.8, Biden 42.8
  AZ: 0.31, // Biden 49.22, Trump 48.91
  AR: -27.6, // Trump 62.4, Biden 34.8
  CA: 29.2, // Biden 63.5, Trump 34.3
  CO: 13.5, // Biden 55.4, Trump 41.9
  CT: 20.0, // Biden 59.2, Trump 39.2
  DE: 18.9, // Biden 58.7, Trump 39.8
  DC: 86.8, // Biden 92.2, Trump 5.4
  FL: -3.3, // Trump 51.2, Biden 47.9
  GA: 0.24, // Biden 49.47, Trump 49.24
  HI: 29.4, // Biden 63.7, Trump 34.3
  ID: -30.7, // Trump 63.8, Biden 33.1
  IL: 16.9, // Biden 57.5, Trump 40.6
  IN: -15.8, // Trump 56.8, Biden 41.0
  IA: -8.2, // Trump 53.1, Biden 44.9
  KS: -14.8, // Trump 56.2, Biden 41.4
  KY: -25.9, // Trump 62.1, Biden 36.2
  LA: -18.6, // Trump 58.5, Biden 39.9
  ME: 9.1, // Biden 53.1, Trump 44.0
  MD: 33.2, // Biden 65.4, Trump 32.2
  MA: 33.5, // Biden 65.6, Trump 32.1
  MI: 2.8, // Biden 50.6, Trump 47.8
  MN: 7.1, // Biden 52.4, Trump 45.3
  MS: -16.5, // Trump 57.6, Biden 41.1
  MO: -15.4, // Trump 56.8, Biden 41.4
  MT: -16.4, // Trump 56.9, Biden 40.5
  NE: -18.3, // Trump 58.2, Biden 39.9
  NV: 2.4, // Biden 50.1, Trump 47.7
  NH: 7.3, // Biden 52.7, Trump 45.4
  NJ: 15.9, // Biden 57.3, Trump 41.4
  NM: 10.8, // Biden 54.3, Trump 43.5
  NY: 23.0, // Biden 60.9, Trump 37.9
  NC: -1.35, // Trump 49.93, Biden 48.59
  ND: -33.2, // Trump 65.1, Biden 31.8
  OH: -8.1, // Trump 53.3, Biden 45.2
  OK: -33.1, // Trump 65.4, Biden 32.3
  OR: 16.2, // Biden 56.5, Trump 40.4
  PA: 1.2, // Biden 49.9, Trump 48.7
  RI: 20.4, // Biden 59.4, Trump 39.0
  SC: -11.7, // Trump 55.1, Biden 43.4
  SD: -26.2, // Trump 61.8, Biden 35.6
  TN: -23.2, // Trump 60.7, Biden 37.5
  TX: -5.6, // Trump 52.1, Biden 46.5
  UT: -20.5, // Trump 58.1, Biden 37.6
  VT: 35.4, // Biden 66.1, Trump 30.7
  VA: 10.1, // Biden 54.1, Trump 44.0
  WA: 19.2, // Biden 58.0, Trump 38.8
  WV: -38.9, // Trump 68.6, Biden 29.7
  WI: 0.63, // Biden 49.45, Trump 48.82
  WY: -43.4, // Trump 69.9, Biden 26.6
};

/** Convert 2020 margin (Biden % - Trump %) to lean scale -5..+5 (negative=blue, positive=red) */
export function marginToLean(margin: number): number {
  // margin +40 (Biden landslide) -> -4, margin -40 (Trump landslide) -> +4
  // Linear: lean = -margin / 10, clamped to [-5, 5]
  return Math.max(-5, Math.min(5, Math.round((-margin / 10) * 100) / 100));
}
