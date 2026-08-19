/**
 * US state-level TWO-PARTY presidential margins.
 *
 * Convention: margin = (Democratic two-party share) - (Republican two-party share),
 * in percentage points. POSITIVE = Democrat carried the state.
 * Two-party means third-party votes are excluded from the denominator.
 * Rounded to one decimal.
 *
 * Comments after each value show the raw (all-candidate) popular vote shares
 * used to derive the two-party figure.
 */

// =====================================================================
// 1952 - Eisenhower (R) vs Stevenson (D). 48 states, no AK/HI/DC.
// =====================================================================

export const MARGINS_1952: Record<string, number> = {
  AL: 29.5, // Stevenson 64.6 - Eisenhower 35.0
  AZ: -16.7, // Stevenson 41.7 - Eisenhower 58.3
  AR: 12.2, // Stevenson 55.9 - Eisenhower 43.8
  CA: -13.8, // Stevenson 42.7 - Eisenhower 56.4
  CO: -21.5, // Stevenson 39.0 - Eisenhower 60.3
  CT: -11.8, // Stevenson 43.9 - Eisenhower 55.7
  DE: -3.9, // Stevenson 47.9 - Eisenhower 51.8
  FL: -10.0, // Stevenson 45.0 - Eisenhower 55.0
  GA: 39.4, // Stevenson 69.7 - Eisenhower 30.3
  ID: -31.0, // Stevenson 34.4 - Eisenhower 65.4
  IL: -9.9, // Stevenson 44.9 - Eisenhower 54.8
  IN: -17.2, // Stevenson 41.0 - Eisenhower 58.1
  IA: -28.3, // Stevenson 35.6 - Eisenhower 63.8
  KS: -38.5, // Stevenson 30.5 - Eisenhower 68.8
  KY: 0.1, // Stevenson 49.9 - Eisenhower 49.8 (Stevenson carried by ~700 votes)
  LA: 5.8, // Stevenson 52.9 - Eisenhower 47.1
  ME: -32.2, // Stevenson 33.8 - Eisenhower 66.0
  MD: -11.4, // Stevenson 44.0 - Eisenhower 55.4
  MA: -8.7, // Stevenson 45.5 - Eisenhower 54.2
  MI: -11.5, // Stevenson 44.0 - Eisenhower 55.4
  MN: -11.3, // Stevenson 44.1 - Eisenhower 55.3
  MS: 20.8, // Stevenson 60.4 - Eisenhower 39.6
  MO: -1.6, // Stevenson 49.1 - Eisenhower 50.7
  MT: -19.4, // Stevenson 40.1 - Eisenhower 59.4
  NE: -38.4, // Stevenson 30.8 - Eisenhower 69.2
  NV: -22.8, // Stevenson 38.6 - Eisenhower 61.4
  NH: -21.8, // Stevenson 39.1 - Eisenhower 60.9
  NJ: -15.0, // Stevenson 42.0 - Eisenhower 56.8
  NM: -11.2, // Stevenson 44.3 - Eisenhower 55.4
  NY: -12.0, // Stevenson 43.6 - Eisenhower 55.5
  NC: 7.8, // Stevenson 53.9 - Eisenhower 46.1
  ND: -42.9, // Stevenson 28.4 - Eisenhower 71.0
  OH: -13.6, // Stevenson 43.2 - Eisenhower 56.8
  OK: -9.2, // Stevenson 45.4 - Eisenhower 54.6
  OR: -21.7, // Stevenson 38.9 - Eisenhower 60.5
  PA: -5.8, // Stevenson 46.9 - Eisenhower 52.7
  RI: -1.8, // Stevenson 49.1 - Eisenhower 50.9
  SC: 1.4, // Stevenson 50.7 - Eisenhower 49.3 (Ike's vote largely on independent electors)
  SD: -38.6, // Stevenson 30.7 - Eisenhower 69.3
  TN: -0.3, // Stevenson 49.7 - Eisenhower 50.0
  TX: -6.4, // Stevenson 46.7 - Eisenhower 53.1
  UT: -17.8, // Stevenson 41.1 - Eisenhower 58.9
  VT: -43.4, // Stevenson 28.2 - Eisenhower 71.5
  VA: -12.9, // Stevenson 43.4 - Eisenhower 56.3
  WA: -9.7, // Stevenson 44.7 - Eisenhower 54.3
  WV: 3.8, // Stevenson 51.9 - Eisenhower 48.1
  WI: -22.4, // Stevenson 38.7 - Eisenhower 61.0
  WY: -25.6, // Stevenson 37.1 - Eisenhower 62.7
};

/* ---------------------------------------------------------------------
 * 1952 SANITY CHECK
 * National two-party margin: D -10.9  (Eisenhower 55.2% / Stevenson 44.3% raw;
 *   two-party 55.4 R / 44.6 D)
 * Electoral vote: Eisenhower 442, Stevenson 89
 * Stevenson (D) carried 9 states: AL AR GA KY LA MS NC SC WV
 * Eisenhower (R) carried the other 39: AZ CA CO CT DE FL ID IL IN IA KS ME MD
 *   MA MI MN MO MT NE NV NH NJ NM NY ND OH OK OR PA RI SD TN TX UT VT VA WA
 *   WI WY
 * Notable: Eisenhower is the first Republican since Reconstruction to carry
 *   FL, TX and VA; the four Deep South states Stevenson held (AL GA MS SC)
 *   plus AR/LA are the residue of the one-party South.
 * ------------------------------------------------------------------- */

// =====================================================================
// 1980 - Reagan (R) vs Carter (D), Anderson (I) 6.6% excluded. 50 states + DC.
// =====================================================================

export const MARGINS_1980: Record<string, number> = {
  AL: -1.3, // Carter 47.5 - Reagan 48.8
  AK: -34.6, // Carter 26.4 - Reagan 54.4
  AZ: -36.5, // Carter 28.2 - Reagan 60.6
  AR: -0.6, // Carter 47.5 - Reagan 48.1
  CA: -18.9, // Carter 35.9 - Reagan 52.7
  CO: -27.8, // Carter 31.1 - Reagan 55.1
  CT: -11.2, // Carter 38.5 - Reagan 48.2
  DE: -2.5, // Carter 44.9 - Reagan 47.2
  DC: 69.6, // Carter 74.8 - Reagan 13.4
  FL: -18.1, // Carter 38.5 - Reagan 55.5
  GA: 15.3, // Carter 55.8 - Reagan 41.0
  HI: 2.2, // Carter 44.8 - Reagan 42.9
  ID: -45.1, // Carter 25.2 - Reagan 66.5
  IL: -8.7, // Carter 41.7 - Reagan 49.7
  IN: -19.5, // Carter 37.7 - Reagan 56.0
  IA: -14.1, // Carter 38.6 - Reagan 51.3
  KS: -27.0, // Carter 33.3 - Reagan 57.9
  KY: -1.6, // Carter 47.6 - Reagan 49.1
  LA: -5.7, // Carter 45.7 - Reagan 51.2
  ME: -3.8, // Carter 42.3 - Reagan 45.6 (Anderson 10.2, unusually strong)
  MD: 3.2, // Carter 47.1 - Reagan 44.2
  MA: -0.2, // Carter 41.7 - Reagan 41.9 (Anderson 15.2; Reagan by ~3,800 votes)
  MI: -7.1, // Carter 42.5 - Reagan 49.0
  MN: 4.4, // Carter 46.5 - Reagan 42.6
  MS: -1.3, // Carter 48.1 - Reagan 49.4
  MO: -7.2, // Carter 44.3 - Reagan 51.2
  MT: -27.4, // Carter 32.4 - Reagan 56.8
  NE: -43.2, // Carter 26.0 - Reagan 65.5
  NV: -39.8, // Carter 26.9 - Reagan 62.5
  NH: -34.1, // Carter 28.4 - Reagan 57.7
  NJ: -14.8, // Carter 38.6 - Reagan 52.0
  NM: -19.9, // Carter 36.7 - Reagan 54.9
  NY: -3.0, // Carter 44.0 - Reagan 46.7
  NC: -2.2, // Carter 47.2 - Reagan 49.3
  ND: -41.9, // Carter 26.3 - Reagan 64.2
  OH: -11.5, // Carter 40.9 - Reagan 51.5
  OK: -26.7, // Carter 35.0 - Reagan 60.5
  OR: -11.0, // Carter 38.7 - Reagan 48.3
  PA: -7.7, // Carter 42.5 - Reagan 49.6
  RI: 12.4, // Carter 47.7 - Reagan 37.2
  SC: -1.3, // Carter 48.1 - Reagan 49.4
  SD: -31.3, // Carter 31.7 - Reagan 60.5
  TN: -0.3, // Carter 48.4 - Reagan 48.7
  TX: -14.4, // Carter 41.4 - Reagan 55.3
  UT: -55.8, // Carter 20.6 - Reagan 72.8
  VT: -7.3, // Carter 38.4 - Reagan 44.4 (Anderson 14.9)
  VA: -13.6, // Carter 40.3 - Reagan 53.0
  WA: -14.2, // Carter 37.3 - Reagan 49.7
  WV: 4.7, // Carter 49.8 - Reagan 45.3
  WI: -5.2, // Carter 43.2 - Reagan 47.9
  WY: -38.1, // Carter 28.0 - Reagan 62.6
};

/* ---------------------------------------------------------------------
 * 1980 SANITY CHECK
 * National two-party margin: D -10.6  (Reagan 50.8% / Carter 41.0% /
 *   Anderson 6.6% raw; two-party 55.3 R / 44.7 D)
 * Electoral vote: Reagan 489, Carter 49
 * Carter (D) carried 6 states + DC: GA HI MD MN RI WV + DC
 * Reagan (R) carried the other 44: AL AK AZ AR CA CO CT DE FL ID IL IN IA KS
 *   KY LA ME MA MI MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA SC SD TN TX
 *   UT VT VA WA WI WY
 * Notable: Anderson's 6.6% is stripped out here, which flatters Carter in the
 *   Northeast (MA goes from a 0.2pt raw loss to a 0.2pt two-party loss;
 *   VT and ME tighten sharply). The Deep South is now near-even, not
 *   Democratic: AL MS SC all inside 1.5pts, TN inside 0.5pts.
 * ------------------------------------------------------------------- */

// =====================================================================
// 1992 - Clinton (D) vs Bush (R), Perot 18.9% excluded. 50 states + DC.
// =====================================================================

export const MARGINS_1992: Record<string, number> = {
  AL: -7.6, // Clinton 40.9 - Bush 47.6
  AK: -13.2, // Clinton 30.3 - Bush 39.5 (Perot 28.4, his best state)
  AZ: -2.7, // Clinton 36.5 - Bush 38.5
  AR: 20.0, // Clinton 53.2 - Bush 35.5 (home state)
  CA: 17.0, // Clinton 46.0 - Bush 32.6
  CO: 5.5, // Clinton 40.1 - Bush 35.9
  CT: 8.2, // Clinton 42.2 - Bush 35.8
  DE: 10.4, // Clinton 43.5 - Bush 35.3
  DC: 80.5, // Clinton 84.6 - Bush 9.1
  FL: -2.4, // Clinton 39.0 - Bush 40.9
  GA: 0.7, // Clinton 43.5 - Bush 42.9
  HI: 13.5, // Clinton 48.1 - Bush 36.7
  ID: -19.3, // Clinton 28.4 - Bush 42.0
  IL: 17.2, // Clinton 48.6 - Bush 34.3
  IN: -7.6, // Clinton 36.8 - Bush 42.9
  IA: 7.4, // Clinton 43.3 - Bush 37.3
  KS: -7.2, // Clinton 33.7 - Bush 38.9
  KY: 3.8, // Clinton 44.6 - Bush 41.3
  LA: 5.3, // Clinton 45.6 - Bush 41.0
  ME: 12.1, // Clinton 38.8 - Bush 30.4 (Perot 30.4, second place)
  MD: 16.6, // Clinton 49.8 - Bush 35.6
  MA: 24.2, // Clinton 47.5 - Bush 29.0
  MI: 9.2, // Clinton 43.8 - Bush 36.4
  MN: 15.4, // Clinton 43.5 - Bush 31.9
  MS: -9.8, // Clinton 40.8 - Bush 49.7
  MO: 13.1, // Clinton 44.1 - Bush 33.9
  MT: 3.4, // Clinton 37.6 - Bush 35.1
  NE: -22.6, // Clinton 29.4 - Bush 46.6
  NV: 3.7, // Clinton 37.4 - Bush 34.7
  NH: 1.7, // Clinton 38.9 - Bush 37.6
  NJ: 2.9, // Clinton 43.0 - Bush 40.6
  NM: 10.3, // Clinton 45.9 - Bush 37.3
  NY: 18.9, // Clinton 49.7 - Bush 33.9
  NC: -0.8, // Clinton 42.7 - Bush 43.4
  ND: -15.7, // Clinton 32.2 - Bush 44.2
  OH: 2.4, // Clinton 40.2 - Bush 38.3
  OK: -11.2, // Clinton 34.0 - Bush 42.6
  OR: 13.3, // Clinton 42.5 - Bush 32.5
  PA: 11.1, // Clinton 45.1 - Bush 36.1
  RI: 23.7, // Clinton 47.0 - Bush 29.0
  SC: -9.2, // Clinton 39.9 - Bush 48.0
  SD: -4.6, // Clinton 37.1 - Bush 40.7
  TN: 5.2, // Clinton 47.1 - Bush 42.4 (Gore home state)
  TX: -4.5, // Clinton 37.1 - Bush 40.6
  UT: -27.4, // Clinton 24.7 - Bush 43.4 (Perot 27.3, second place)
  VT: 20.5, // Clinton 46.1 - Bush 30.4
  VA: -5.1, // Clinton 40.6 - Bush 45.0
  WA: 15.1, // Clinton 43.4 - Bush 32.0
  WV: 15.6, // Clinton 48.4 - Bush 35.4
  WI: 5.5, // Clinton 41.1 - Bush 36.8
  WY: -7.6, // Clinton 34.0 - Bush 39.6
};

/* ---------------------------------------------------------------------
 * 1992 SANITY CHECK
 * National two-party margin: D +6.9  (Clinton 43.0% / Bush 37.4% /
 *   Perot 18.9% raw; two-party 53.5 D / 46.5 R)
 * Electoral vote: Clinton 370, Bush 168
 * Bush (R) carried 18 states: AL AK AZ FL ID IN KS MS NE NC ND OK SC SD TX
 *   UT VA WY
 * Clinton (D) carried the other 32 + DC: AR CA CO CT DE DC GA HI IL IA KY LA
 *   ME MD MA MI MN MO MT NV NH NJ NM NY OH OR PA RI TN VT WA WV WI
 * Notable: excluding Perot inflates every margin's apparent decisiveness.
 *   GA (+0.7) and NC (-0.8) are effectively ties; MT, NV, NH are Clinton
 *   states only on the two-party count and were won with ~38% raw.
 * ------------------------------------------------------------------- */

// =====================================================================
// 2000 - Bush (R) vs Gore (D), Nader 2.7% excluded. 50 states + DC.
// =====================================================================

export const MARGINS_2000: Record<string, number> = {
  AL: -15.2, // Gore 41.6 - Bush 56.5
  AK: -35.8, // Gore 27.7 - Bush 58.6
  AZ: -6.6, // Gore 44.7 - Bush 51.0
  AR: -5.6, // Gore 45.9 - Bush 51.3
  CA: 12.3, // Gore 53.4 - Bush 41.7
  CO: -9.0, // Gore 42.4 - Bush 50.8
  CT: 18.6, // Gore 55.9 - Bush 38.4
  DE: 13.5, // Gore 55.0 - Bush 41.9
  DC: 80.9, // Gore 85.2 - Bush 9.0
  FL: 0.0, // Gore 48.84 - Bush 48.85 (Bush by 537 votes; certified)
  GA: -11.8, // Gore 43.2 - Bush 54.7
  HI: 19.6, // Gore 55.8 - Bush 37.5
  ID: -41.8, // Gore 27.6 - Bush 67.2
  IL: 12.3, // Gore 54.6 - Bush 42.6
  IN: -16.0, // Gore 41.0 - Bush 56.6
  IA: 0.3, // Gore 48.5 - Bush 48.2
  KS: -21.8, // Gore 37.2 - Bush 58.0
  KY: -15.4, // Gore 41.4 - Bush 56.5
  LA: -7.9, // Gore 44.9 - Bush 52.6
  ME: 5.5, // Gore 49.1 - Bush 44.0
  MD: 16.9, // Gore 56.6 - Bush 40.2
  MA: 29.6, // Gore 59.8 - Bush 32.5
  MI: 5.3, // Gore 51.3 - Bush 46.1
  MN: 2.6, // Gore 47.9 - Bush 45.5
  MS: -17.2, // Gore 40.7 - Bush 57.6
  MO: -3.4, // Gore 47.1 - Bush 50.4
  MT: -27.3, // Gore 33.4 - Bush 58.4
  NE: -30.3, // Gore 33.3 - Bush 62.2
  NV: -3.7, // Gore 46.0 - Bush 49.5
  NH: -1.4, // Gore 46.8 - Bush 48.1 (Nader 3.9 exceeds the margin)
  NJ: 16.4, // Gore 56.1 - Bush 40.3
  NM: 0.1, // Gore 47.9 - Bush 47.8 (Gore by 366 votes)
  NY: 26.2, // Gore 60.2 - Bush 35.2
  NC: -12.8, // Gore 43.2 - Bush 56.0
  ND: -29.4, // Gore 33.1 - Bush 60.7
  OH: -3.6, // Gore 46.5 - Bush 50.0
  OK: -22.2, // Gore 38.4 - Bush 60.3
  OR: 0.5, // Gore 47.0 - Bush 46.5
  PA: 4.3, // Gore 50.6 - Bush 46.4
  RI: 31.3, // Gore 61.0 - Bush 31.9
  SC: -16.3, // Gore 40.9 - Bush 56.8
  SD: -23.2, // Gore 37.6 - Bush 60.3
  TN: -3.9, // Gore 47.3 - Bush 51.1 (Gore loses his home state)
  TX: -21.9, // Gore 38.0 - Bush 59.3
  UT: -43.6, // Gore 26.3 - Bush 66.8
  VT: 10.8, // Gore 50.6 - Bush 40.7
  VA: -8.4, // Gore 44.4 - Bush 52.5
  WA: 5.9, // Gore 50.2 - Bush 44.6
  WV: -6.5, // Gore 45.6 - Bush 51.9
  WI: 0.2, // Gore 47.8 - Bush 47.6 (Gore by ~5,700 votes)
  WY: -42.0, // Gore 27.7 - Bush 67.8
};

/* ---------------------------------------------------------------------
 * 2000 SANITY CHECK
 * National two-party margin: D +0.5  (Gore 48.4% / Bush 47.9% /
 *   Nader 2.7% raw; two-party 50.3 D / 49.7 R)
 * Electoral vote: Bush 271, Gore 266 (one DC elector abstained; 267 pledged)
 * Gore (D) carried 20 states + DC: CA CT DE DC HI IL IA ME MD MA MI MN NJ NM
 *   NY OR PA RI VT WA WI
 * Bush (R) carried the other 30: AL AK AZ AR CO FL GA ID IN KS KY LA MS MO MT
 *   NE NV NH NC ND OH OK SC SD TN TX UT VA WV WY
 * Notable: the popular-vote/electoral-vote inversion. Four states inside
 *   0.5pts two-party (FL, IA, NM, WI); Gore loses TN, AR and WV, all states
 *   Clinton had carried twice.
 * ------------------------------------------------------------------- */

// =====================================================================
// 2008 - Obama (D) vs McCain (R). 50 states + DC.
// =====================================================================

export const MARGINS_2008: Record<string, number> = {
  AL: -21.8, // Obama 38.7 - McCain 60.3
  AK: -22.0, // Obama 37.9 - McCain 59.4
  AZ: -8.6, // Obama 45.1 - McCain 53.6 (McCain home state)
  AR: -20.2, // Obama 38.9 - McCain 58.7
  CA: 24.5, // Obama 61.0 - McCain 37.0
  CO: 9.1, // Obama 53.7 - McCain 44.7
  CT: 22.7, // Obama 60.6 - McCain 38.2
  DE: 25.4, // Obama 61.9 - McCain 36.9 (Biden home state)
  DC: 86.9, // Obama 92.5 - McCain 6.5
  FL: 2.8, // Obama 51.0 - McCain 48.2
  GA: -5.2, // Obama 47.0 - McCain 52.2
  HI: 46.0, // Obama 71.8 - McCain 26.6 (Obama home state)
  ID: -26.0, // Obama 36.1 - McCain 61.5
  IL: 25.4, // Obama 61.9 - McCain 36.8 (Obama home state)
  IN: 1.0, // Obama 49.9 - McCain 48.9 (first D win since 1964)
  IA: 9.7, // Obama 53.9 - McCain 44.4
  KS: -15.2, // Obama 41.7 - McCain 56.6
  KY: -16.4, // Obama 41.2 - McCain 57.4
  LA: -19.0, // Obama 39.9 - McCain 58.6
  ME: 17.6, // Obama 57.7 - McCain 40.4
  MD: 25.8, // Obama 61.9 - McCain 36.5
  MA: 26.4, // Obama 61.8 - McCain 36.0
  MI: 16.7, // Obama 57.4 - McCain 41.0
  MN: 10.5, // Obama 54.1 - McCain 43.8
  MS: -13.3, // Obama 43.0 - McCain 56.2
  MO: -0.1, // Obama 49.3 - McCain 49.4 (McCain by ~3,900 votes)
  MT: -2.4, // Obama 47.2 - McCain 49.5
  NE: -15.1, // Obama 41.6 - McCain 56.5 (Obama took NE-02's elector)
  NV: 12.7, // Obama 55.1 - McCain 42.7
  NH: 9.7, // Obama 54.1 - McCain 44.5
  NJ: 15.9, // Obama 57.3 - McCain 41.6
  NM: 15.3, // Obama 56.9 - McCain 41.8
  NY: 27.2, // Obama 62.9 - McCain 36.0
  NC: 0.3, // Obama 49.7 - McCain 49.4 (first D win since 1976)
  ND: -8.9, // Obama 44.6 - McCain 53.3
  OH: 4.7, // Obama 51.5 - McCain 46.9
  OK: -31.2, // Obama 34.4 - McCain 65.6 (no county carried)
  OR: 16.8, // Obama 56.7 - McCain 40.4
  PA: 10.4, // Obama 54.5 - McCain 44.2
  RI: 28.2, // Obama 62.9 - McCain 35.2
  SC: -9.1, // Obama 44.9 - McCain 53.9
  SD: -8.7, // Obama 44.7 - McCain 53.2
  TN: -15.2, // Obama 41.8 - McCain 56.9
  TX: -11.9, // Obama 43.7 - McCain 55.5
  UT: -29.1, // Obama 34.4 - McCain 62.6
  VT: 37.8, // Obama 67.5 - McCain 30.5
  VA: 6.4, // Obama 52.6 - McCain 46.3 (first D win since 1964)
  WA: 17.6, // Obama 57.7 - McCain 40.5
  WV: -13.3, // Obama 42.6 - McCain 55.7
  WI: 14.2, // Obama 56.2 - McCain 42.3
  WY: -33.2, // Obama 32.5 - McCain 64.8
};

/* ---------------------------------------------------------------------
 * 2008 SANITY CHECK
 * National two-party margin: D +7.4  (Obama 52.9% / McCain 45.7% raw;
 *   two-party 53.7 D / 46.3 R)
 * Electoral vote: Obama 365, McCain 173 (includes NE-02 for Obama under
 *   Nebraska's congressional-district allocation)
 * Obama (D) carried 28 states + DC: CA CO CT DE DC FL HI IL IN IA ME MD MA MI
 *   MN NV NH NJ NM NY NC OH OR PA RI VT VA WA WI
 * McCain (R) carried the other 22: AL AK AZ AR GA ID KS KY LA MS MO MT NE ND
 *   OK SC SD TN TX UT WV WY
 * Notable: the Appalachian/Ozark counter-swing. AR (-20.2), WV (-13.3), TN
 *   (-15.2), OK (-31.2) move AWAY from the Democrats against a national
 *   +7.4 tide, while the Mountain West (CO, NV, NM) and the coastal South
 *   (VA, NC, FL) flip in.
 * ------------------------------------------------------------------- */

/**
 * Cross-model provenance: the tables above were generated independently by
 * two models (Opus 5, Grok 4.6) and cross-checked cell-by-cell 2026-08-19:
 * 249 state cells, zero sign disagreements, zero gaps over 2pp. These are
 * VALIDATION references for the era lean calibration (geography rank
 * checks). Ideology is not party: never write state lean = f(margin)
 * directly into seed data for eras where party and ideology decoupled.
 */
export const HISTORICAL_MARGINS: Record<
  "1952" | "1980" | "1992" | "2000" | "2008",
  Record<string, number>
> = {
  "1952": MARGINS_1952,
  "1980": MARGINS_1980,
  "1992": MARGINS_1992,
  "2000": MARGINS_2000,
  "2008": MARGINS_2008,
};

/** National House two-party popular-vote margin (D minus R), the standing-electorate baseline per era. */
export const HOUSE_NATIONAL_MARGIN: Record<"1952" | "1980" | "1992" | "2000" | "2008", number> = {
  "1952": -0.1,
  "1980": 2.5,
  "1992": 5.5,
  "2000": -0.4,
  "2008": 11.1,
};
