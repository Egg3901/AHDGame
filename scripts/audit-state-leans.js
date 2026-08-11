#!/usr/bin/env node
/**
 * Audit script: Computes state leans from demographics seed data and
 * compares against 2020 election margins to identify anomalies.
 *
 * Run: node scripts/audit-state-leans.js
 */

// ── 2020 Election Results ──
const ELECTION_2020_MARGIN = {
  AL: -25.4,
  AK: -10.0,
  AZ: 0.31,
  AR: -27.6,
  CA: 29.2,
  CO: 13.5,
  CT: 20.0,
  DE: 18.9,
  DC: 86.8,
  FL: -3.3,
  GA: 0.24,
  HI: 29.4,
  ID: -30.7,
  IL: 16.9,
  IN: -15.8,
  IA: -8.2,
  KS: -14.8,
  KY: -25.9,
  LA: -18.6,
  ME: 9.1,
  MD: 33.2,
  MA: 33.5,
  MI: 2.8,
  MN: 7.1,
  MS: -16.5,
  MO: -15.4,
  MT: -16.4,
  NE: -18.3,
  NV: 2.4,
  NH: 7.3,
  NJ: 15.9,
  NM: 10.8,
  NY: 23.0,
  NC: -1.35,
  ND: -33.2,
  OH: -8.1,
  OK: -33.1,
  OR: 16.2,
  PA: 1.2,
  RI: 20.4,
  SC: -11.7,
  SD: -26.2,
  TN: -23.2,
  TX: -5.6,
  UT: -20.5,
  VT: 35.4,
  VA: 10.1,
  WA: 19.2,
  WV: -38.9,
  WI: 0.63,
  WY: -43.4,
};

// ── Turnout Rates ──
const DEMOGRAPHIC_TURNOUT_RATES = {
  race: { white: 63, black: 60, hispanic: 48, asian: 52, other: 52 },
  age: { young: 38, mid: 56, mature: 66, senior: 73 },
  education: { no_college: 52, college: 66, graduate: 74 },
  wealth: { low: 44, middle: 60, high: 74 },
  ideology: {
    evangelicals: 75,
    environmentalists: 66,
    libertarians: 64,
    progressives: 64,
    patriots: 68,
    gunowners: 66,
  },
};

// ── Default Group Leans ──
const DEFAULT_LEANS = {
  young_renters: { economicLean: -4, socialLean: -4 },
  evangelicals: { economicLean: 4, socialLean: 5 },
  rural_traditionalists: { economicLean: 4, socialLean: 4 },
  union_trades: { economicLean: -3, socialLean: 1 },
  soccer_moms: { economicLean: 0, socialLean: -1 },
  college_liberals: { economicLean: -5, socialLean: -5 },
  small_business: { economicLean: 4, socialLean: 2 },
  public_sector: { economicLean: -3, socialLean: -2 },
  retirees: { economicLean: 2, socialLean: 3 },
  libertarians: { economicLean: 5, socialLean: 2 },
  new_immigrants: { economicLean: -2, socialLean: -1 },
  secular_professionals: { economicLean: -3, socialLean: -4 },
};

const DEFAULT_TURNOUTS = {
  young_renters: 38,
  evangelicals: 72,
  rural_traditionalists: 68,
  union_trades: 52,
  soccer_moms: 58,
  college_liberals: 68,
  small_business: 72,
  public_sector: 70,
  retirees: 72,
  libertarians: 68,
  new_immigrants: 42,
  secular_professionals: 74,
};

// ── Voter Group Composition ──
const VOTER_GROUP_COMPOSITION = {
  young_renters: {
    weights: [
      { dim: "age", key: "young", w: 0.35 },
      { dim: "wealth", key: "low", w: 0.25 },
      { dim: "education", key: "no_college", w: 0.15 },
    ],
  },
  evangelicals: { weights: [{ dim: "ideology", key: "evangelicals", w: 1.2 }] },
  rural_traditionalists: {
    weights: [
      { dim: "education", key: "no_college", w: 0.15 },
      { dim: "ideology", key: "patriots", w: 0.5 },
      { dim: "ideology", key: "gunowners", w: 0.5 },
    ],
  },
  union_trades: {
    weights: [
      { dim: "education", key: "no_college", w: 0.2 },
      { dim: "wealth", key: "low", w: 0.35 },
      { dim: "race", key: "black", w: 0.15 },
    ],
  },
  soccer_moms: {
    weights: [
      { dim: "age", key: "mid", w: 0.5 },
      { dim: "wealth", key: "middle", w: 0.5 },
    ],
  },
  college_liberals: {
    weights: [
      { dim: "education", key: "college", w: 0.15 },
      { dim: "education", key: "graduate", w: 0.15 },
      { dim: "ideology", key: "progressives", w: 0.35 },
      { dim: "ideology", key: "environmentalists", w: 0.35 },
    ],
  },
  small_business: {
    weights: [
      { dim: "wealth", key: "high", w: 0.45 },
      { dim: "ideology", key: "libertarians", w: 0.4 },
      { dim: "age", key: "mature", w: 0.3 },
    ],
  },
  public_sector: {
    weights: [
      { dim: "education", key: "college", w: 0.15 },
      { dim: "education", key: "graduate", w: 0.15 },
      { dim: "ideology", key: "progressives", w: 0.35 },
      { dim: "wealth", key: "middle", w: 0.25 },
    ],
  },
  retirees: { weights: [{ dim: "age", key: "senior", w: 0.6 }] },
  libertarians: { weights: [{ dim: "ideology", key: "libertarians", w: 1.2 }] },
  new_immigrants: {
    weights: [
      { dim: "race", key: "hispanic", w: 0.5 },
      { dim: "race", key: "asian", w: 0.3 },
      { dim: "race", key: "other", w: 0.2 },
    ],
    civicMultiplier: 0.8,
  },
  secular_professionals: {
    weights: [
      { dim: "education", key: "graduate", w: 0.25 },
      { dim: "wealth", key: "high", w: 0.25 },
      { dim: "ideology", key: "environmentalists", w: 0.25 },
      { dim: "ideology", key: "progressives", w: 0.25 },
    ],
  },
};

const voterGroupIds = [
  "young_renters",
  "evangelicals",
  "rural_traditionalists",
  "union_trades",
  "soccer_moms",
  "college_liberals",
  "small_business",
  "public_sector",
  "retirees",
  "libertarians",
  "new_immigrants",
  "secular_professionals",
];

// ── State Layer 1 Configs ──
const STATE_CONFIGS = {
  CT: {
    race: { white: 66, black: 12, hispanic: 17, asian: 5, other: 0 },
    education: { no_college: 52, college: 30, graduate: 18 },
    wealth: { low: 22, middle: 52, high: 26 },
    age: { young: 22, mid: 25, mature: 27, senior: 26 },
    ideology: {
      evangelicals: 6,
      environmentalists: 13,
      libertarians: 5,
      progressives: 19,
      patriots: 3,
      gunowners: 5,
    },
  },
  DE: {
    race: { white: 62, black: 23, hispanic: 10, asian: 4, other: 1 },
    education: { no_college: 56, college: 30, graduate: 14 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 23, mid: 25, mature: 26, senior: 26 },
    ideology: {
      evangelicals: 6,
      environmentalists: 14,
      libertarians: 5,
      progressives: 20,
      patriots: 4,
      gunowners: 5,
    },
  },
  MA: {
    race: { white: 71, black: 9, hispanic: 12, asian: 7, other: 1 },
    education: { no_college: 48, college: 30, graduate: 22 },
    wealth: { low: 22, middle: 50, high: 28 },
    age: { young: 24, mid: 26, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 5,
      environmentalists: 14,
      libertarians: 4,
      progressives: 18,
      patriots: 4,
      gunowners: 5,
    },
  },
  MD: {
    race: { white: 50, black: 31, hispanic: 11, asian: 7, other: 1 },
    education: { no_college: 50, college: 30, graduate: 20 },
    wealth: { low: 22, middle: 52, high: 26 },
    age: { young: 24, mid: 27, mature: 27, senior: 22 },
    ideology: {
      evangelicals: 8,
      environmentalists: 12,
      libertarians: 4,
      progressives: 19,
      patriots: 4,
      gunowners: 5,
    },
  },
  ME: {
    race: { white: 93, black: 2, hispanic: 2, asian: 1, other: 2 },
    education: { no_college: 58, college: 28, graduate: 14 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 20, mid: 23, mature: 28, senior: 29 },
    ideology: {
      evangelicals: 7,
      environmentalists: 13,
      libertarians: 7,
      progressives: 14,
      patriots: 5,
      gunowners: 9,
    },
  },
  NH: {
    race: { white: 90, black: 2, hispanic: 4, asian: 3, other: 1 },
    education: { no_college: 52, college: 32, graduate: 16 },
    wealth: { low: 20, middle: 54, high: 26 },
    age: { young: 21, mid: 25, mature: 28, senior: 26 },
    ideology: {
      evangelicals: 6,
      environmentalists: 12,
      libertarians: 9,
      progressives: 13,
      patriots: 5,
      gunowners: 9,
    },
  },
  NJ: {
    race: { white: 54, black: 15, hispanic: 21, asian: 10, other: 0 },
    education: { no_college: 50, college: 30, graduate: 20 },
    wealth: { low: 22, middle: 50, high: 28 },
    age: { young: 23, mid: 26, mature: 27, senior: 24 },
    ideology: {
      evangelicals: 6,
      environmentalists: 13,
      libertarians: 5,
      progressives: 19,
      patriots: 4,
      gunowners: 5,
    },
  },
  NY: {
    race: { white: 54, black: 18, hispanic: 19, asian: 9, other: 0 },
    education: { no_college: 52, college: 28, graduate: 20 },
    wealth: { low: 28, middle: 48, high: 24 },
    age: { young: 24, mid: 27, mature: 26, senior: 23 },
    ideology: {
      evangelicals: 7,
      environmentalists: 12,
      libertarians: 4,
      progressives: 18,
      patriots: 4,
      gunowners: 6,
    },
  },
  PA: {
    race: { white: 76, black: 12, hispanic: 8, asian: 4, other: 0 },
    education: { no_college: 58, college: 28, graduate: 14 },
    wealth: { low: 26, middle: 54, high: 20 },
    age: { young: 22, mid: 24, mature: 27, senior: 27 },
    ideology: {
      evangelicals: 12,
      environmentalists: 8,
      libertarians: 6,
      progressives: 12,
      patriots: 7,
      gunowners: 11,
    },
  },
  RI: {
    race: { white: 71, black: 8, hispanic: 16, asian: 4, other: 1 },
    education: { no_college: 54, college: 30, graduate: 16 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 24, mid: 26, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 5,
      environmentalists: 14,
      libertarians: 5,
      progressives: 18,
      patriots: 3,
      gunowners: 5,
    },
  },
  VT: {
    race: { white: 93, black: 1, hispanic: 2, asian: 2, other: 2 },
    education: { no_college: 52, college: 30, graduate: 18 },
    wealth: { low: 26, middle: 54, high: 20 },
    age: { young: 22, mid: 24, mature: 28, senior: 26 },
    ideology: {
      evangelicals: 5,
      environmentalists: 18,
      libertarians: 6,
      progressives: 18,
      patriots: 4,
      gunowners: 7,
    },
  },
  AL: {
    race: { white: 65, black: 27, hispanic: 5, asian: 2, other: 1 },
    education: { no_college: 64, college: 26, graduate: 10 },
    wealth: { low: 34, middle: 50, high: 16 },
    age: { young: 24, mid: 25, mature: 27, senior: 24 },
    ideology: {
      evangelicals: 38,
      environmentalists: 2,
      libertarians: 4,
      progressives: 4,
      patriots: 18,
      gunowners: 22,
    },
  },
  AR: {
    race: { white: 72, black: 16, hispanic: 8, asian: 2, other: 2 },
    education: { no_college: 66, college: 24, graduate: 10 },
    wealth: { low: 34, middle: 52, high: 14 },
    age: { young: 24, mid: 25, mature: 26, senior: 25 },
    ideology: {
      evangelicals: 36,
      environmentalists: 2,
      libertarians: 5,
      progressives: 4,
      patriots: 17,
      gunowners: 21,
    },
  },
  FL: {
    race: { white: 53, black: 17, hispanic: 26, asian: 3, other: 1 },
    education: { no_college: 58, college: 28, graduate: 14 },
    wealth: { low: 28, middle: 50, high: 22 },
    age: { young: 22, mid: 24, mature: 26, senior: 28 },
    ideology: {
      evangelicals: 17,
      environmentalists: 7,
      libertarians: 7,
      progressives: 9,
      patriots: 10,
      gunowners: 13,
    },
  },
  GA: {
    race: { white: 52, black: 33, hispanic: 10, asian: 4, other: 1 },
    education: { no_college: 58, college: 28, graduate: 14 },
    wealth: { low: 28, middle: 52, high: 20 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 15,
      environmentalists: 8,
      libertarians: 5,
      progressives: 14,
      patriots: 8,
      gunowners: 11,
    },
  },
  KY: {
    race: { white: 84, black: 8, hispanic: 4, asian: 2, other: 2 },
    education: { no_college: 64, college: 26, graduate: 10 },
    wealth: { low: 32, middle: 52, high: 16 },
    age: { young: 24, mid: 25, mature: 27, senior: 24 },
    ideology: {
      evangelicals: 24,
      environmentalists: 4,
      libertarians: 6,
      progressives: 7,
      patriots: 12,
      gunowners: 16,
    },
  },
  LA: {
    race: { white: 58, black: 33, hispanic: 6, asian: 2, other: 1 },
    education: { no_college: 64, college: 26, graduate: 10 },
    wealth: { low: 34, middle: 50, high: 16 },
    age: { young: 26, mid: 26, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 26,
      environmentalists: 4,
      libertarians: 5,
      progressives: 8,
      patriots: 10,
      gunowners: 14,
    },
  },
  MS: {
    race: { white: 56, black: 38, hispanic: 3, asian: 1, other: 2 },
    education: { no_college: 66, college: 24, graduate: 10 },
    wealth: { low: 38, middle: 48, high: 14 },
    age: { young: 26, mid: 25, mature: 26, senior: 23 },
    ideology: {
      evangelicals: 30,
      environmentalists: 3,
      libertarians: 4,
      progressives: 7,
      patriots: 11,
      gunowners: 14,
    },
  },
  NC: {
    race: { white: 62, black: 22, hispanic: 10, asian: 3, other: 3 },
    education: { no_college: 58, college: 28, graduate: 14 },
    wealth: { low: 28, middle: 52, high: 20 },
    age: { young: 24, mid: 26, mature: 27, senior: 23 },
    ideology: {
      evangelicals: 15,
      environmentalists: 8,
      libertarians: 6,
      progressives: 14,
      patriots: 8,
      gunowners: 10,
    },
  },
  SC: {
    race: { white: 63, black: 27, hispanic: 6, asian: 2, other: 2 },
    education: { no_college: 60, college: 28, graduate: 12 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 24, mid: 25, mature: 27, senior: 24 },
    ideology: {
      evangelicals: 22,
      environmentalists: 4,
      libertarians: 6,
      progressives: 8,
      patriots: 11,
      gunowners: 14,
    },
  },
  TN: {
    race: { white: 73, black: 17, hispanic: 6, asian: 2, other: 2 },
    education: { no_college: 60, college: 28, graduate: 12 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 24, mid: 26, mature: 27, senior: 23 },
    ideology: {
      evangelicals: 24,
      environmentalists: 4,
      libertarians: 6,
      progressives: 7,
      patriots: 11,
      gunowners: 15,
    },
  },
  VA: {
    race: { white: 61, black: 20, hispanic: 10, asian: 7, other: 2 },
    education: { no_college: 50, college: 30, graduate: 20 },
    wealth: { low: 22, middle: 52, high: 26 },
    age: { young: 24, mid: 27, mature: 27, senior: 22 },
    ideology: {
      evangelicals: 10,
      environmentalists: 11,
      libertarians: 6,
      progressives: 16,
      patriots: 6,
      gunowners: 9,
    },
  },
  WV: {
    race: { white: 92, black: 4, hispanic: 2, asian: 1, other: 1 },
    education: { no_college: 68, college: 22, graduate: 10 },
    wealth: { low: 36, middle: 50, high: 14 },
    age: { young: 22, mid: 23, mature: 28, senior: 27 },
    ideology: {
      evangelicals: 22,
      environmentalists: 4,
      libertarians: 6,
      progressives: 5,
      patriots: 14,
      gunowners: 18,
    },
  },
  IA: {
    race: { white: 85, black: 4, hispanic: 6, asian: 3, other: 2 },
    education: { no_college: 58, college: 30, graduate: 12 },
    wealth: { low: 24, middle: 56, high: 20 },
    age: { young: 24, mid: 24, mature: 26, senior: 26 },
    ideology: {
      evangelicals: 16,
      environmentalists: 7,
      libertarians: 7,
      progressives: 8,
      patriots: 9,
      gunowners: 13,
    },
  },
  IL: {
    race: { white: 61, black: 15, hispanic: 18, asian: 6, other: 0 },
    education: { no_college: 54, college: 30, graduate: 16 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 24, mid: 26, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 7,
      environmentalists: 13,
      libertarians: 5,
      progressives: 19,
      patriots: 4,
      gunowners: 5,
    },
  },
  IN: {
    race: { white: 79, black: 10, hispanic: 7, asian: 3, other: 1 },
    education: { no_college: 62, college: 26, graduate: 12 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 24, mid: 26, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 18,
      environmentalists: 5,
      libertarians: 7,
      progressives: 8,
      patriots: 10,
      gunowners: 14,
    },
  },
  KS: {
    race: { white: 75, black: 6, hispanic: 12, asian: 3, other: 4 },
    education: { no_college: 56, college: 30, graduate: 14 },
    wealth: { low: 26, middle: 54, high: 20 },
    age: { young: 26, mid: 26, mature: 25, senior: 23 },
    ideology: {
      evangelicals: 20,
      environmentalists: 5,
      libertarians: 8,
      progressives: 7,
      patriots: 11,
      gunowners: 14,
    },
  },
  MI: {
    race: { white: 74, black: 14, hispanic: 5, asian: 3, other: 4 },
    education: { no_college: 58, college: 28, graduate: 14 },
    wealth: { low: 28, middle: 52, high: 20 },
    age: { young: 23, mid: 25, mature: 27, senior: 25 },
    ideology: {
      evangelicals: 12,
      environmentalists: 8,
      libertarians: 6,
      progressives: 11,
      patriots: 7,
      gunowners: 12,
    },
  },
  MN: {
    race: { white: 79, black: 7, hispanic: 6, asian: 5, other: 3 },
    education: { no_college: 52, college: 32, graduate: 16 },
    wealth: { low: 22, middle: 56, high: 22 },
    age: { young: 24, mid: 27, mature: 26, senior: 23 },
    ideology: {
      evangelicals: 9,
      environmentalists: 12,
      libertarians: 6,
      progressives: 14,
      patriots: 5,
      gunowners: 10,
    },
  },
  MO: {
    race: { white: 79, black: 12, hispanic: 5, asian: 2, other: 2 },
    education: { no_college: 60, college: 28, graduate: 12 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 24, mid: 25, mature: 26, senior: 25 },
    ideology: {
      evangelicals: 20,
      environmentalists: 5,
      libertarians: 7,
      progressives: 8,
      patriots: 11,
      gunowners: 14,
    },
  },
  ND: {
    race: { white: 84, black: 3, hispanic: 4, asian: 2, other: 7 },
    education: { no_college: 56, college: 32, graduate: 12 },
    wealth: { low: 22, middle: 58, high: 20 },
    age: { young: 26, mid: 26, mature: 25, senior: 23 },
    ideology: {
      evangelicals: 18,
      environmentalists: 5,
      libertarians: 9,
      progressives: 5,
      patriots: 13,
      gunowners: 16,
    },
  },
  NE: {
    race: { white: 79, black: 5, hispanic: 12, asian: 3, other: 1 },
    education: { no_college: 56, college: 30, graduate: 14 },
    wealth: { low: 24, middle: 56, high: 20 },
    age: { young: 26, mid: 26, mature: 25, senior: 23 },
    ideology: {
      evangelicals: 18,
      environmentalists: 5,
      libertarians: 8,
      progressives: 6,
      patriots: 12,
      gunowners: 14,
    },
  },
  OH: {
    race: { white: 78, black: 13, hispanic: 4, asian: 2, other: 3 },
    education: { no_college: 60, college: 28, graduate: 12 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 23, mid: 25, mature: 27, senior: 25 },
    ideology: {
      evangelicals: 16,
      environmentalists: 6,
      libertarians: 7,
      progressives: 9,
      patriots: 9,
      gunowners: 13,
    },
  },
  SD: {
    race: { white: 82, black: 2, hispanic: 4, asian: 2, other: 10 },
    education: { no_college: 58, college: 30, graduate: 12 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 24, mid: 25, mature: 26, senior: 25 },
    ideology: {
      evangelicals: 18,
      environmentalists: 5,
      libertarians: 9,
      progressives: 5,
      patriots: 13,
      gunowners: 16,
    },
  },
  WI: {
    race: { white: 81, black: 7, hispanic: 7, asian: 3, other: 2 },
    education: { no_college: 56, college: 30, graduate: 14 },
    wealth: { low: 24, middle: 56, high: 20 },
    age: { young: 23, mid: 25, mature: 27, senior: 25 },
    ideology: {
      evangelicals: 12,
      environmentalists: 9,
      libertarians: 7,
      progressives: 11,
      patriots: 7,
      gunowners: 11,
    },
  },
  AZ: {
    race: { white: 54, black: 5, hispanic: 32, asian: 4, other: 5 },
    education: { no_college: 58, college: 28, graduate: 14 },
    wealth: { low: 28, middle: 52, high: 20 },
    age: { young: 24, mid: 26, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 11,
      environmentalists: 10,
      libertarians: 9,
      progressives: 12,
      patriots: 8,
      gunowners: 10,
    },
  },
  NM: {
    race: { white: 37, black: 2, hispanic: 49, asian: 2, other: 10 },
    education: { no_college: 58, college: 28, graduate: 14 },
    wealth: { low: 32, middle: 50, high: 18 },
    age: { young: 24, mid: 25, mature: 27, senior: 24 },
    ideology: {
      evangelicals: 10,
      environmentalists: 12,
      libertarians: 6,
      progressives: 15,
      patriots: 6,
      gunowners: 8,
    },
  },
  OK: {
    race: { white: 65, black: 8, hispanic: 11, asian: 2, other: 14 },
    education: { no_college: 62, college: 26, graduate: 12 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 26, mid: 26, mature: 25, senior: 23 },
    ideology: {
      evangelicals: 26,
      environmentalists: 4,
      libertarians: 7,
      progressives: 6,
      patriots: 12,
      gunowners: 16,
    },
  },
  TX: {
    race: { white: 41, black: 13, hispanic: 40, asian: 5, other: 1 },
    education: { no_college: 60, college: 28, graduate: 12 },
    wealth: { low: 28, middle: 52, high: 20 },
    age: { young: 27, mid: 27, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 19,
      environmentalists: 6,
      libertarians: 9,
      progressives: 10,
      patriots: 10,
      gunowners: 13,
    },
  },
  AK: {
    race: { white: 60, black: 4, hispanic: 7, asian: 6, other: 23 },
    education: { no_college: 56, college: 30, graduate: 14 },
    wealth: { low: 22, middle: 56, high: 22 },
    age: { young: 26, mid: 28, mature: 28, senior: 18 },
    ideology: {
      evangelicals: 14,
      environmentalists: 8,
      libertarians: 12,
      progressives: 7,
      patriots: 12,
      gunowners: 16,
    },
  },
  CA: {
    race: { white: 37, black: 6, hispanic: 39, asian: 15, other: 3 },
    education: { no_college: 52, college: 32, graduate: 16 },
    wealth: { low: 28, middle: 50, high: 22 },
    age: { young: 26, mid: 27, mature: 25, senior: 22 },
    ideology: {
      evangelicals: 8,
      environmentalists: 16,
      libertarians: 5,
      progressives: 18,
      patriots: 4,
      gunowners: 6,
    },
  },
  CO: {
    race: { white: 68, black: 4, hispanic: 22, asian: 4, other: 2 },
    education: { no_college: 50, college: 32, graduate: 18 },
    wealth: { low: 22, middle: 54, high: 24 },
    age: { young: 26, mid: 28, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 9,
      environmentalists: 14,
      libertarians: 9,
      progressives: 14,
      patriots: 6,
      gunowners: 9,
    },
  },
  HI: {
    race: { white: 22, black: 2, hispanic: 11, asian: 37, other: 28 },
    education: { no_college: 54, college: 30, graduate: 16 },
    wealth: { low: 22, middle: 54, high: 24 },
    age: { young: 24, mid: 26, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 7,
      environmentalists: 15,
      libertarians: 4,
      progressives: 17,
      patriots: 4,
      gunowners: 5,
    },
  },
  ID: {
    race: { white: 82, black: 1, hispanic: 13, asian: 2, other: 2 },
    education: { no_college: 60, college: 28, graduate: 12 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 26, mid: 26, mature: 25, senior: 23 },
    ideology: {
      evangelicals: 16,
      environmentalists: 6,
      libertarians: 12,
      progressives: 5,
      patriots: 13,
      gunowners: 18,
    },
  },
  MT: {
    race: { white: 86, black: 1, hispanic: 4, asian: 1, other: 8 },
    education: { no_college: 56, college: 30, graduate: 14 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 22, mid: 24, mature: 28, senior: 26 },
    ideology: {
      evangelicals: 14,
      environmentalists: 8,
      libertarians: 12,
      progressives: 6,
      patriots: 12,
      gunowners: 18,
    },
  },
  NV: {
    race: { white: 48, black: 10, hispanic: 29, asian: 9, other: 4 },
    education: { no_college: 60, college: 28, graduate: 12 },
    wealth: { low: 28, middle: 52, high: 20 },
    age: { young: 24, mid: 27, mature: 27, senior: 22 },
    ideology: {
      evangelicals: 10,
      environmentalists: 8,
      libertarians: 10,
      progressives: 10,
      patriots: 8,
      gunowners: 11,
    },
  },
  OR: {
    race: { white: 75, black: 2, hispanic: 13, asian: 5, other: 5 },
    education: { no_college: 54, college: 30, graduate: 16 },
    wealth: { low: 26, middle: 54, high: 20 },
    age: { young: 24, mid: 26, mature: 27, senior: 23 },
    ideology: {
      evangelicals: 6,
      environmentalists: 18,
      libertarians: 8,
      progressives: 18,
      patriots: 4,
      gunowners: 6,
    },
  },
  UT: {
    race: { white: 78, black: 1, hispanic: 14, asian: 3, other: 4 },
    education: { no_college: 54, college: 32, graduate: 14 },
    wealth: { low: 20, middle: 58, high: 22 },
    age: { young: 30, mid: 28, mature: 23, senior: 19 },
    ideology: {
      evangelicals: 30,
      environmentalists: 5,
      libertarians: 8,
      progressives: 5,
      patriots: 10,
      gunowners: 10,
    },
  },
  WA: {
    race: { white: 68, black: 4, hispanic: 13, asian: 10, other: 5 },
    education: { no_college: 50, college: 32, graduate: 18 },
    wealth: { low: 22, middle: 54, high: 24 },
    age: { young: 24, mid: 28, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 7,
      environmentalists: 17,
      libertarians: 7,
      progressives: 18,
      patriots: 4,
      gunowners: 7,
    },
  },
  WY: {
    race: { white: 84, black: 1, hispanic: 10, asian: 1, other: 4 },
    education: { no_college: 60, college: 28, graduate: 12 },
    wealth: { low: 24, middle: 58, high: 18 },
    age: { young: 24, mid: 26, mature: 27, senior: 23 },
    ideology: {
      evangelicals: 16,
      environmentalists: 5,
      libertarians: 13,
      progressives: 4,
      patriots: 14,
      gunowners: 20,
    },
  },
  DC: {
    race: { white: 38, black: 46, hispanic: 11, asian: 4, other: 1 },
    education: { no_college: 38, college: 32, graduate: 30 },
    wealth: { low: 30, middle: 40, high: 30 },
    age: { young: 28, mid: 30, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 6,
      environmentalists: 16,
      libertarians: 3,
      progressives: 28,
      patriots: 3,
      gunowners: 4,
    },
  },
};

// ── Derivation Functions (matching source code) ──

function deriveGroupPopulations(config) {
  const { race, education, wealth, age, ideology } = config;
  const t = DEMOGRAPHIC_TURNOUT_RATES;

  const vw = {
    r: {
      white: (race.white * t.race.white) / 100,
      black: (race.black * t.race.black) / 100,
      hispanic: (race.hispanic * t.race.hispanic) / 100,
      asian: (race.asian * t.race.asian) / 100,
      other: (race.other * t.race.other) / 100,
    },
    a: {
      young: (age.young * t.age.young) / 100,
      mid: (age.mid * t.age.mid) / 100,
      mature: (age.mature * t.age.mature) / 100,
      senior: (age.senior * t.age.senior) / 100,
    },
    e: {
      no_college: (education.no_college * t.education.no_college) / 100,
      college: (education.college * t.education.college) / 100,
      graduate: (education.graduate * t.education.graduate) / 100,
    },
    w: {
      low: (wealth.low * t.wealth.low) / 100,
      middle: (wealth.middle * t.wealth.middle) / 100,
      high: (wealth.high * t.wealth.high) / 100,
    },
    i: {
      evangelicals: (ideology.evangelicals * t.ideology.evangelicals) / 100,
      environmentalists: (ideology.environmentalists * t.ideology.environmentalists) / 100,
      libertarians: (ideology.libertarians * t.ideology.libertarians) / 100,
      progressives: (ideology.progressives * t.ideology.progressives) / 100,
      patriots: (ideology.patriots * t.ideology.patriots) / 100,
      gunowners: (ideology.gunowners * t.ideology.gunowners) / 100,
    },
  };

  const raw = {
    young_renters: vw.a.young * 0.35 + vw.w.low * 0.25 + vw.e.no_college * 0.15,
    evangelicals: vw.i.evangelicals * 1.2,
    rural_traditionalists: vw.e.no_college * 0.15 + vw.i.patriots * 0.5 + vw.i.gunowners * 0.5,
    union_trades: vw.e.no_college * 0.2 + vw.w.low * 0.35 + vw.r.black * 0.15,
    soccer_moms: vw.a.mid * 0.5 + vw.w.middle * 0.5,
    college_liberals:
      vw.e.college * 0.15 +
      vw.e.graduate * 0.15 +
      vw.i.progressives * 0.35 +
      vw.i.environmentalists * 0.35,
    small_business: vw.w.high * 0.45 + vw.i.libertarians * 0.4 + vw.a.mature * 0.3,
    public_sector:
      vw.e.college * 0.15 + vw.e.graduate * 0.15 + vw.i.progressives * 0.35 + vw.w.middle * 0.25,
    retirees: vw.a.senior * 0.6,
    libertarians: vw.i.libertarians * 1.2,
    new_immigrants: vw.r.hispanic * 0.5 + vw.r.asian * 0.3 + vw.r.other * 0.2,
    secular_professionals:
      vw.e.graduate * 0.25 +
      vw.w.high * 0.25 +
      vw.i.environmentalists * 0.25 +
      vw.i.progressives * 0.25,
  };

  const total = Object.values(raw).reduce((s, v) => s + v, 0);
  for (const id of voterGroupIds) {
    raw[id] = total > 0 ? (raw[id] / total) * 100 : 100 / 12;
  }
  return raw;
}

function clampLean(v) {
  return Math.max(-5, Math.min(5, Math.round(v * 10) / 10));
}

function deriveGroupLean(groupId, config) {
  const { ideology } = config;
  const def = { ...DEFAULT_LEANS[groupId] };
  const conservativeNet =
    ideology.patriots + ideology.gunowners - (ideology.progressives + ideology.environmentalists);
  const progressiveNet =
    ideology.progressives +
    ideology.environmentalists -
    (ideology.evangelicals + ideology.patriots);

  switch (groupId) {
    case "retirees":
      return {
        economicLean: clampLean(def.economicLean + conservativeNet * 0.04),
        socialLean: clampLean(def.socialLean + conservativeNet * 0.05),
      };
    case "soccer_moms":
      return {
        economicLean: clampLean(def.economicLean - progressiveNet * 0.02),
        socialLean: clampLean(def.socialLean - progressiveNet * 0.02),
      };
    case "union_trades":
      return {
        economicLean: clampLean(
          def.economicLean - (ideology.progressives - ideology.patriots) * 0.02
        ),
        socialLean: def.socialLean,
      };
    case "rural_traditionalists":
      return {
        economicLean: def.economicLean,
        socialLean: clampLean(def.socialLean + conservativeNet * 0.025),
      };
    default:
      return def;
  }
}

function deriveGroupTurnout(groupId, config, baseTurnout) {
  const composition = VOTER_GROUP_COMPOSITION[groupId];
  if (!composition) return baseTurnout;

  const totalWeight = composition.weights.reduce((s, c) => s + c.w, 0);
  let base = 0;
  for (const { dim, key, w } of composition.weights) {
    const rates = DEMOGRAPHIC_TURNOUT_RATES[dim];
    const turnoutRate = rates[key] ?? 55;
    base += turnoutRate * (w / totalWeight);
  }

  const multiplier = composition.civicMultiplier ?? 1.0;
  base *= multiplier;

  const { age, education, race } = config;
  switch (groupId) {
    case "young_renters":
      return Math.round(Math.max(28, Math.min(52, base - (age.young - 24) * 0.4)));
    case "retirees":
      return Math.round(Math.max(68, Math.min(80, base + (age.senior - 24) * 0.3)));
    case "secular_professionals":
      return Math.round(Math.max(66, Math.min(80, base + (education.graduate - 14) * 0.15)));
    case "new_immigrants":
      return Math.round(
        Math.max(30, Math.min(52, base + (race.hispanic + race.asian - 24) * 0.05))
      );
    default:
      return Math.round(Math.max(25, Math.min(85, base)));
  }
}

function getDisplayLean(economicLean, socialLean) {
  const sameSign = economicLean >= 0 === socialLean >= 0;
  if (sameSign) {
    return Math.round(((economicLean + socialLean) / 2) * 100) / 100;
  }
  const dominant = Math.abs(economicLean) >= Math.abs(socialLean) ? economicLean : socialLean;
  return Math.round(dominant * 100) / 100;
}

function getLeanLabel(lean) {
  if (lean <= -0.6) return "Very Left";
  if (lean <= -0.2) return "Left";
  if (lean < 0.2) return "Center";
  if (lean < 0.6) return "Right";
  return "Very Right";
}

// ── State Names for nicer output ──
const STATE_NAMES = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "Washington DC",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

// ── Expected Labels (based on real-world political consensus) ──
// Game scale: Very Left ≤ -0.6, Left ≤ -0.2, Center < +0.2, Right < +0.6, Very Right ≥ +0.6
const EXPECTED_LABELS = {
  // Safe D (2020 margin > +15) → should be Very Left
  DC: "Very Left",
  MA: "Very Left",
  VT: "Very Left",
  MD: "Very Left",
  HI: "Very Left",
  CA: "Very Left",
  NY: "Very Left",
  CT: "Very Left",
  RI: "Very Left",
  WA: "Very Left",
  OR: "Very Left",
  IL: "Very Left",
  DE: "Very Left",
  NJ: "Very Left",

  // Lean D (2020 margin +5 to +15) → should be Left
  CO: "Left",
  NM: "Left",
  VA: "Left",
  ME: "Left",
  MN: "Left",
  NH: "Left",

  // Toss-up (2020 margin < ±5) → should be Center
  PA: "Center",
  WI: "Center",
  GA: "Center",
  AZ: "Center",
  MI: "Center",
  NV: "Center",
  NC: "Center",

  // Lean R (2020 margin -5 to -15) → should be Right
  FL: "Right",
  TX: "Right",
  OH: "Right",
  IA: "Right",
  AK: "Right",

  // Safe R (2020 margin < -15) → should be Very Right
  IN: "Very Right",
  KS: "Very Right",
  MO: "Very Right",
  MT: "Very Right",
  NE: "Very Right",
  SC: "Very Right",
  SD: "Very Right",
  LA: "Very Right",
  MS: "Very Right",
  KY: "Very Right",
  TN: "Very Right",
  AR: "Very Right",
  AL: "Very Right",
  OK: "Very Right",
  ND: "Very Right",
  ID: "Very Right",
  WV: "Very Right",
  WY: "Very Right",
  UT: "Very Right",
};

const LABEL_ORDER = ["Very Left", "Left", "Center", "Right", "Very Right"];
function labelIndex(label) {
  return LABEL_ORDER.indexOf(label);
}
function labelDiff(actual, expected) {
  return labelIndex(actual) - labelIndex(expected);
}

// ── Run Audit ──
console.log("═══════════════════════════════════════════════════════════════════════════════");
console.log("  STATE DEMOGRAPHICS & LEAN AUDIT (using game's calibrated scale)");
console.log(
  "  Scale: Very Left ≤ -0.6 | Left ≤ -0.2 | Center < +0.2 | Right < +0.6 | Very Right ≥ +0.6"
);
console.log("═══════════════════════════════════════════════════════════════════════════════\n");

// First pass: validate Layer 1 sums
console.log("── LAYER 1 VALIDATION (should each sum to 100) ──\n");
let validationErrors = [];
for (const [stateId, config] of Object.entries(STATE_CONFIGS)) {
  const raceSum = Object.values(config.race).reduce((a, b) => a + b, 0);
  const eduSum = Object.values(config.education).reduce((a, b) => a + b, 0);
  const wealthSum = Object.values(config.wealth).reduce((a, b) => a + b, 0);
  const ageSum = Object.values(config.age).reduce((a, b) => a + b, 0);

  const issues = [];
  if (raceSum !== 100) issues.push(`race=${raceSum}`);
  if (eduSum !== 100) issues.push(`education=${eduSum}`);
  if (wealthSum !== 100) issues.push(`wealth=${wealthSum}`);
  if (ageSum !== 100) issues.push(`age=${ageSum}`);

  if (issues.length > 0) {
    validationErrors.push({ stateId, issues });
    console.log(`  ❌ ${stateId} (${STATE_NAMES[stateId]}): ${issues.join(", ")}`);
  }
}
if (validationErrors.length === 0) {
  console.log(
    "  ✓ All states pass Layer 1 sum validation (race, education, wealth, age all sum to 100)"
  );
}

// Second pass: compute derived leans
console.log("\n── STATE LEAN COMPUTATION (game scale) ──\n");

const results = [];

for (const [stateId, config] of Object.entries(STATE_CONFIGS)) {
  const populations = deriveGroupPopulations(config);

  // Build groups
  const groups = {};
  for (const id of voterGroupIds) {
    const baseTurnout = DEFAULT_TURNOUTS[id];
    const derivedTurnout = deriveGroupTurnout(id, config, baseTurnout);
    groups[id] = {
      population: Math.round(populations[id] * 100) / 100,
      ...deriveGroupLean(id, config),
      turnout: derivedTurnout,
    };
  }

  // Calculate state lean (turnout-weighted)
  let totalWeight = 0;
  let weightedEconomic = 0;
  let weightedSocial = 0;

  for (const id of voterGroupIds) {
    const g = groups[id];
    const pop = g.population;
    const turnout = g.turnout;
    const weight = (pop / 100) * (turnout / 100) * (100 / 100);
    totalWeight += weight;
    weightedEconomic += weight * g.economicLean;
    weightedSocial += weight * g.socialLean;
  }

  const economicLean =
    totalWeight > 0
      ? Math.max(-5, Math.min(5, Math.round((weightedEconomic / totalWeight) * 100) / 100))
      : 0;
  const socialLean =
    totalWeight > 0
      ? Math.max(-5, Math.min(5, Math.round((weightedSocial / totalWeight) * 100) / 100))
      : 0;
  const displayLean = getDisplayLean(economicLean, socialLean);
  const modelLabel = getLeanLabel(displayLean);
  const expectedLabel = EXPECTED_LABELS[stateId];
  const margin2020 = ELECTION_2020_MARGIN[stateId];
  const ld = labelDiff(modelLabel, expectedLabel);

  results.push({
    stateId,
    name: STATE_NAMES[stateId],
    economicLean,
    socialLean,
    displayLean,
    modelLabel,
    expectedLabel,
    labelShift: ld, // 0 = correct, +1 = one step too right, -1 = one step too left, etc.
    margin2020,
    groups,
  });
}

// Sort by label shift magnitude, then alphabetically
results.sort(
  (a, b) => Math.abs(b.labelShift) - Math.abs(a.labelShift) || a.stateId.localeCompare(b.stateId)
);

// Print all states
console.log(
  "State            | Econ   | Social | Display | Model Label  | Expected     | Shift | 2020 Margin"
);
console.log(
  "─────────────────┼────────┼────────┼─────────┼──────────────┼──────────────┼───────┼────────────"
);

const mismatches = [];
const correctCount = { total: 0, exact: 0, off1: 0, off2: 0, off3: 0 };

for (const r of results) {
  correctCount.total++;
  const shift = r.labelShift;
  if (shift === 0) correctCount.exact++;
  else if (Math.abs(shift) === 1) correctCount.off1++;
  else if (Math.abs(shift) === 2) correctCount.off2++;
  else correctCount.off3++;

  if (shift !== 0) mismatches.push(r);

  const shiftStr = shift === 0 ? "  ✓  " : shift > 0 ? `+${shift} →` : `${shift} ←`;
  const flag = Math.abs(shift) >= 2 ? " ❌" : shift !== 0 ? " ⚠️" : "";

  console.log(
    `${(r.stateId + " " + r.name).padEnd(17)}| ${r.economicLean >= 0 ? "+" : ""}${r.economicLean.toFixed(2).padStart(5)}  | ${r.socialLean >= 0 ? "+" : ""}${r.socialLean.toFixed(2).padStart(5)}  | ${r.displayLean >= 0 ? "+" : ""}${r.displayLean.toFixed(2).padStart(5)}   | ${r.modelLabel.padEnd(13)}| ${r.expectedLabel.padEnd(13)}| ${shiftStr} | ${r.margin2020 >= 0 ? "+" : ""}${r.margin2020.toFixed(1).padStart(5)}${flag}`
  );
}

// Summary
console.log("\n═══════════════════════════════════════════════════════════════════════════════");
console.log("  LABEL CLASSIFICATION SUMMARY");
console.log("═══════════════════════════════════════════════════════════════════════════════\n");

console.log(`  ✓ Correct label:    ${correctCount.exact}/${correctCount.total} states`);
console.log(`  ⚠️  Off by 1 step:   ${correctCount.off1} states`);
console.log(`  ❌ Off by 2+ steps:  ${correctCount.off2 + correctCount.off3} states`);

// Detailed breakdown of mismatches
if (mismatches.length > 0) {
  // Group by direction of shift
  const tooRight = mismatches.filter((r) => r.labelShift > 0);
  const tooLeft = mismatches.filter((r) => r.labelShift < 0);

  if (tooRight.length > 0) {
    console.log(`\n  LEANING TOO RIGHT (model label is more conservative than expected):`);
    for (const r of tooRight.sort((a, b) => b.labelShift - a.labelShift)) {
      const severity = Math.abs(r.labelShift) >= 2 ? "❌" : "⚠️";
      console.log(
        `    ${severity} ${r.stateId} ${r.name}: ${r.expectedLabel} → ${r.modelLabel} (shift +${r.labelShift}, display=${r.displayLean >= 0 ? "+" : ""}${r.displayLean.toFixed(2)}, 2020=${r.margin2020 >= 0 ? "+" : ""}${r.margin2020.toFixed(1)})`
      );
    }
  }

  if (tooLeft.length > 0) {
    console.log(`\n  LEANING TOO LEFT (model label is more liberal than expected):`);
    for (const r of tooLeft.sort((a, b) => a.labelShift - b.labelShift)) {
      const severity = Math.abs(r.labelShift) >= 2 ? "❌" : "⚠️";
      console.log(
        `    ${severity} ${r.stateId} ${r.name}: ${r.expectedLabel} → ${r.modelLabel} (shift ${r.labelShift}, display=${r.displayLean >= 0 ? "+" : ""}${r.displayLean.toFixed(2)}, 2020=${r.margin2020 >= 0 ? "+" : ""}${r.margin2020.toFixed(1)})`
      );
    }
  }
}

// Deep dive on off-by-2+ states
const severe = mismatches.filter((r) => Math.abs(r.labelShift) >= 2);
if (severe.length > 0) {
  console.log("\n── DEEP DIVE: OFF BY 2+ STEPS ──\n");
  for (const r of severe) {
    console.log(
      `  ${r.stateId} ${r.name}: Expected ${r.expectedLabel}, Got ${r.modelLabel} (shift ${r.labelShift > 0 ? "+" : ""}${r.labelShift})`
    );
    console.log(
      `    Display lean: ${r.displayLean.toFixed(2)}  |  Economic: ${r.economicLean.toFixed(2)}  |  Social: ${r.socialLean.toFixed(2)}`
    );
    console.log(
      `    2020 margin: ${r.margin2020 >= 0 ? "Biden" : "Trump"} ${r.margin2020 >= 0 ? "+" : ""}${r.margin2020.toFixed(1)}`
    );
    console.log(
      `    Ideology: evan=${STATE_CONFIGS[r.stateId].ideology.evangelicals} env=${STATE_CONFIGS[r.stateId].ideology.environmentalists} lib=${STATE_CONFIGS[r.stateId].ideology.libertarians} prog=${STATE_CONFIGS[r.stateId].ideology.progressives} pat=${STATE_CONFIGS[r.stateId].ideology.patriots} gun=${STATE_CONFIGS[r.stateId].ideology.gunowners}`
    );

    const sortedGroups = voterGroupIds
      .map((id) => ({
        id,
        ...r.groups[id],
        weight: (r.groups[id].population / 100) * (r.groups[id].turnout / 100),
      }))
      .sort((a, b) => b.weight - a.weight);

    console.log(`    Top voter groups by weight:`);
    for (const g of sortedGroups.slice(0, 6)) {
      const dl = getDisplayLean(g.economicLean, g.socialLean);
      console.log(
        `      ${g.id.padEnd(24)} pop=${g.population.toFixed(1).padStart(5)}%  turnout=${String(g.turnout).padStart(2)}%  econ=${g.economicLean >= 0 ? "+" : ""}${g.economicLean.toFixed(1)}  soc=${g.socialLean >= 0 ? "+" : ""}${g.socialLean.toFixed(1)}  disp=${dl >= 0 ? "+" : ""}${dl.toFixed(1)}`
      );
    }
    console.log();
  }
}

// Turnout audit
console.log("── TURNOUT AUDIT ──\n");
const turnoutIssues = [];
for (const r of results) {
  for (const id of voterGroupIds) {
    const g = r.groups[id];
    if (g.turnout < 25)
      turnoutIssues.push({
        state: r.stateId,
        group: id,
        turnout: g.turnout,
        issue: "Very low (<25)",
      });
    if (g.turnout > 85)
      turnoutIssues.push({
        state: r.stateId,
        group: id,
        turnout: g.turnout,
        issue: "Very high (>85)",
      });
  }
}
if (turnoutIssues.length > 0) {
  console.log(`  ⚠️  Extreme turnout values: ${turnoutIssues.length}`);
  for (const t of turnoutIssues) {
    console.log(`    ${t.state}: ${t.group} turnout=${t.turnout}% (${t.issue})`);
  }
} else {
  console.log("  ✓ All group turnout values within normal range (25-85%)");
}

// Population share audit
console.log("\n── POPULATION SHARE AUDIT ──\n");
const popIssues = [];
for (const r of results) {
  let sum = 0;
  for (const id of voterGroupIds) {
    const pop = r.groups[id].population;
    sum += pop;
    if (pop < 1) popIssues.push({ state: r.stateId, group: id, pop, issue: "Very small (<1%)" });
    if (pop > 25) popIssues.push({ state: r.stateId, group: id, pop, issue: "Very large (>25%)" });
  }
  if (Math.abs(sum - 100) > 0.5)
    popIssues.push({
      state: r.stateId,
      group: "TOTAL",
      pop: sum,
      issue: `Sum is ${sum.toFixed(2)}, not 100`,
    });
}
if (popIssues.length > 0) {
  console.log(`  ⚠️  Population share issues: ${popIssues.length}`);
  for (const p of popIssues) {
    console.log(`    ${p.state}: ${p.group} population=${p.pop.toFixed(2)}% (${p.issue})`);
  }
} else {
  console.log("  ✓ All group population shares within normal range");
}

// EV distribution by label
console.log("\n── ELECTORAL VOTE DISTRIBUTION BY LABEL ──\n");
const EV_COUNTS = {
  AL: 9,
  AK: 3,
  AZ: 11,
  AR: 6,
  CA: 54,
  CO: 10,
  CT: 7,
  DE: 3,
  DC: 3,
  FL: 30,
  GA: 16,
  HI: 4,
  ID: 4,
  IL: 19,
  IN: 11,
  IA: 6,
  KS: 6,
  KY: 8,
  LA: 8,
  ME: 4,
  MD: 10,
  MA: 11,
  MI: 15,
  MN: 10,
  MS: 6,
  MO: 10,
  MT: 4,
  NE: 5,
  NV: 6,
  NH: 4,
  NJ: 14,
  NM: 5,
  NY: 28,
  NC: 16,
  ND: 3,
  OH: 17,
  OK: 7,
  OR: 8,
  PA: 19,
  RI: 4,
  SC: 9,
  SD: 3,
  TN: 11,
  TX: 40,
  UT: 6,
  VA: 13,
  WA: 12,
  WV: 4,
  WI: 10,
  WY: 3,
  RI: 4,
  VT: 3,
};
const evByLabel = {};
for (const r of results) {
  if (!evByLabel[r.modelLabel]) evByLabel[r.modelLabel] = { ev: 0, states: [] };
  evByLabel[r.modelLabel].ev += EV_COUNTS[r.stateId] || 0;
  evByLabel[r.modelLabel].states.push(r.stateId);
}
for (const label of LABEL_ORDER) {
  const d = evByLabel[label] || { ev: 0, states: [] };
  console.log(
    `  ${label.padEnd(12)} ${String(d.ev).padStart(3)} EVs  (${d.states.length} states: ${d.states.join(", ")})`
  );
}

console.log("\n═══════════════════════════════════════════════════════════════════════════════");
console.log("  AUDIT COMPLETE");
console.log("═══════════════════════════════════════════════════════════════════════════════");
