import type { Layer1Config } from "./stateDemographics";

/**
 * 1979-era US state census profiles (Layer 1 demographic configs).
 *
 * Era anchor: the 1980 Census. Every state profile here was authored
 * independently from historical knowledge of that state circa 1979 —
 * NOT derived by scaling the 2019 data in `stateCensusData.ts`.
 *
 * Key national reference points (1980 Census / late-1970s surveys):
 * - Race: White ~80%, Black ~11.7%, Hispanic ~6.4%, Asian ~1.5%.
 *   Hispanic population heavily concentrated in NM/TX/CA/AZ/CO/NY/FL;
 *   most of the country was far Whiter than in 2019. Asian share was
 *   negligible outside HI/CA/WA/NY. "Other" carries American Indian /
 *   Alaska Native populations (AK, NM, AZ, OK, SD, MT, ND).
 * - Education: bachelor's-or-higher attainment ~17% nationally
 *   (vs ~33% in 2019); graduate degrees rare. no_college dominates
 *   everywhere; Appalachia/Deep South in the low 60s for HS completion.
 * - Age: median age ~30. Baby boomers were 16-34, so the population is
 *   young-heavy with a small senior cohort (~11% 65+). FL already a
 *   retirement magnet; UT exceptionally young.
 * - Wealth: era-neutral relative tiers. Industrial Midwest (MI/OH/IL)
 *   still prosperous pre-deindustrialization collapse; energy-boom
 *   states (TX/AK/WY/OK/LA) riding the late-70s oil boom; Appalachia
 *   (WV/KY) and the Deep South (MS/AR/AL) poorest; CT/NJ/MD/AK richest.
 * - Ideology (pre-Reagan coding): evangelical political mobilization was
 *   only just beginning (Moral Majority founded 1979) — high cultural
 *   presence in the South but somewhat below 2019 political peaks.
 *   Environmentalist and progressive identification far lower than 2019
 *   (post-Earth Day but pre-mainstreaming). Libertarians a tiny fringe
 *   (party founded 1971), modestly higher in the Mountain West.
 *   Patriots (Cold War nationalism) and gunowners strong in the rural
 *   South/West; the unionized industrial Midwest reads blue-collar
 *   Democratic rather than progressive.
 */
export const stateCensusData1979: Record<string, Layer1Config> = {
  AK: {
    race: { white: 77, black: 3, hispanic: 2, asian: 4, other: 14 },
    education: { no_college: 76, college: 17, graduate: 7 },
    wealth: { low: 22, middle: 52, high: 26 },
    age: { young: 38, mid: 30, mature: 22, senior: 10 },
    ideology: {
      evangelicals: 12,
      environmentalists: 6,
      libertarians: 10,
      progressives: 6,
      patriots: 14,
      gunowners: 24,
    },
    positions: {
      race: { white: { economicLean: 3.2, socialLean: 2.7 } },
    },
  },
  AL: {
    race: { white: 73, black: 25, hispanic: 1, asian: 0, other: 1 },
    education: { no_college: 86, college: 9, graduate: 5 },
    wealth: { low: 38, middle: 48, high: 14 },
    age: { young: 32, mid: 26, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 30,
      environmentalists: 1,
      libertarians: 2,
      progressives: 3,
      patriots: 16,
      gunowners: 20,
    },
    positions: {
      race: { white: { economicLean: 2.7, socialLean: 2.6 } },
    },
  },
  AR: {
    race: { white: 82, black: 16, hispanic: 1, asian: 0, other: 1 },
    education: { no_college: 87, college: 9, graduate: 4 },
    wealth: { low: 40, middle: 47, high: 13 },
    age: { young: 30, mid: 25, mature: 24, senior: 21 },
    ideology: {
      evangelicals: 28,
      environmentalists: 1,
      libertarians: 3,
      progressives: 3,
      patriots: 14,
      gunowners: 20,
    },
    positions: {
      race: { white: { economicLean: 2, socialLean: 2.1 } },
    },
  },
  AZ: {
    race: { white: 75, black: 3, hispanic: 16, asian: 1, other: 5 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 32, mid: 26, mature: 23, senior: 19 },
    ideology: {
      evangelicals: 12,
      environmentalists: 4,
      libertarians: 9,
      progressives: 5,
      patriots: 12,
      gunowners: 17,
    },
    positions: {
      race: { white: { economicLean: 4.1, socialLean: 3.3 } },
    },
  },
  CA: {
    race: { white: 67, black: 8, hispanic: 19, asian: 5, other: 1 },
    education: { no_college: 76, college: 16, graduate: 8 },
    wealth: { low: 24, middle: 52, high: 24 },
    age: { young: 33, mid: 28, mature: 23, senior: 16 },
    ideology: {
      evangelicals: 8,
      environmentalists: 9,
      libertarians: 5,
      progressives: 12,
      patriots: 6,
      gunowners: 8,
    },
    positions: {
      race: { white: { economicLean: 3.2, socialLean: 2 } },
    },
  },
  CO: {
    race: { white: 82, black: 4, hispanic: 12, asian: 1, other: 1 },
    education: { no_college: 73, college: 19, graduate: 8 },
    wealth: { low: 24, middle: 56, high: 20 },
    age: { young: 35, mid: 28, mature: 22, senior: 15 },
    ideology: {
      evangelicals: 10,
      environmentalists: 8,
      libertarians: 8,
      progressives: 8,
      patriots: 9,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 3.1, socialLean: 2.6 } },
    },
  },
  CT: {
    race: { white: 88, black: 7, hispanic: 4, asian: 1, other: 0 },
    education: { no_college: 74, college: 17, graduate: 9 },
    wealth: { low: 18, middle: 52, high: 30 },
    age: { young: 29, mid: 26, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 4,
      environmentalists: 7,
      libertarians: 3,
      progressives: 13,
      patriots: 5,
      gunowners: 6,
    },
    positions: {
      race: { white: { economicLean: 0.9, socialLean: 0.3 } },
    },
  },
  DC: {
    race: { white: 26, black: 70, hispanic: 3, asian: 1, other: 0 },
    education: { no_college: 67, college: 18, graduate: 15 },
    wealth: { low: 36, middle: 42, high: 22 },
    age: { young: 34, mid: 28, mature: 23, senior: 15 },
    ideology: {
      evangelicals: 10,
      environmentalists: 6,
      libertarians: 2,
      progressives: 20,
      patriots: 3,
      gunowners: 3,
    },
    positions: {
      race: { white: { economicLean: 3.4, socialLean: 1.7 } },
    },
  },
  DE: {
    race: { white: 81, black: 16, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 78, college: 15, graduate: 7 },
    wealth: { low: 24, middle: 54, high: 22 },
    age: { young: 31, mid: 27, mature: 25, senior: 17 },
    ideology: {
      evangelicals: 8,
      environmentalists: 5,
      libertarians: 3,
      progressives: 10,
      patriots: 7,
      gunowners: 8,
    },
    positions: {
      race: { white: { economicLean: 1.3, socialLean: 1.1 } },
    },
  },
  FL: {
    race: { white: 76, black: 14, hispanic: 9, asian: 1, other: 0 },
    education: { no_college: 81, college: 13, graduate: 6 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 27, mid: 24, mature: 24, senior: 25 },
    ideology: {
      evangelicals: 16,
      environmentalists: 3,
      libertarians: 5,
      progressives: 6,
      patriots: 12,
      gunowners: 13,
    },
    positions: {
      race: { white: { economicLean: 2.8, socialLean: 2.6 } },
    },
  },
  GA: {
    race: { white: 71, black: 27, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 83, college: 11, graduate: 6 },
    wealth: { low: 36, middle: 48, high: 16 },
    age: { young: 34, mid: 27, mature: 23, senior: 16 },
    ideology: {
      evangelicals: 28,
      environmentalists: 2,
      libertarians: 3,
      progressives: 4,
      patriots: 14,
      gunowners: 17,
    },
    positions: {
      // Carter's Deep South coalition: working-class/rural whites econ-left,
      // social-right (Southern Democrats, pre-realignment).
      race: { white: { economicLean: 4.5, socialLean: 3.4 } },
      education: { no_college: { economicLean: -2.5, socialLean: 0.5 } },
      age: {
        mid: { economicLean: -1.5, socialLean: -0.5 },
        mature: { economicLean: -2.0, socialLean: 0.0 },
        senior: { economicLean: -2.5, socialLean: 0.0 }, // New Deal generation
      },
      wealth: { middle: { economicLean: -2.0, socialLean: -0.5 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 4.0 }, // many still voted Carter (born-again)
        patriots: { economicLean: 1.5, socialLean: 3.0 },
        gunowners: { economicLean: 1.0, socialLean: 2.5 }, // rural Southern Democrats
      },
    },
  },
  HI: {
    race: { white: 33, black: 2, hispanic: 3, asian: 56, other: 6 },
    education: { no_college: 75, college: 17, graduate: 8 },
    wealth: { low: 22, middle: 56, high: 22 },
    age: { young: 34, mid: 29, mature: 23, senior: 14 },
    ideology: {
      evangelicals: 5,
      environmentalists: 8,
      libertarians: 2,
      progressives: 13,
      patriots: 6,
      gunowners: 4,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 2.8 } },
    },
  },
  IA: {
    race: { white: 97, black: 1, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 83, college: 12, graduate: 5 },
    wealth: { low: 26, middle: 58, high: 16 },
    age: { young: 30, mid: 25, mature: 24, senior: 21 },
    ideology: {
      evangelicals: 13,
      environmentalists: 3,
      libertarians: 4,
      progressives: 6,
      patriots: 9,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 1.3, socialLean: 1.5 } },
    },
  },
  ID: {
    race: { white: 94, black: 0, hispanic: 4, asian: 1, other: 1 },
    education: { no_college: 82, college: 13, graduate: 5 },
    wealth: { low: 30, middle: 56, high: 14 },
    age: { young: 34, mid: 26, mature: 23, senior: 17 },
    ideology: {
      evangelicals: 18,
      environmentalists: 3,
      libertarians: 9,
      progressives: 3,
      patriots: 14,
      gunowners: 22,
    },
    positions: {
      race: { white: { economicLean: 3.7, socialLean: 3.4 } },
    },
  },
  IL: {
    race: { white: 78, black: 15, hispanic: 6, asian: 1, other: 0 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 24, middle: 54, high: 22 },
    age: { young: 32, mid: 27, mature: 24, senior: 17 },
    ideology: {
      evangelicals: 9,
      environmentalists: 5,
      libertarians: 3,
      progressives: 11,
      patriots: 7,
      gunowners: 8,
    },
    positions: {
      race: { white: { economicLean: 2, socialLean: 1.5 } },
    },
  },
  IN: {
    race: { white: 90, black: 8, hispanic: 2, asian: 0, other: 0 },
    education: { no_college: 85, college: 10, graduate: 5 },
    wealth: { low: 26, middle: 58, high: 16 },
    age: { young: 32, mid: 26, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 17,
      environmentalists: 2,
      libertarians: 4,
      progressives: 5,
      patriots: 12,
      gunowners: 13,
    },
    positions: {
      race: { white: { economicLean: 2, socialLean: 2.1 } },
    },
  },
  KS: {
    race: { white: 91, black: 5, hispanic: 3, asian: 1, other: 0 },
    education: { no_college: 80, college: 14, graduate: 6 },
    wealth: { low: 26, middle: 58, high: 16 },
    age: { young: 31, mid: 26, mature: 23, senior: 20 },
    ideology: {
      evangelicals: 15,
      environmentalists: 2,
      libertarians: 6,
      progressives: 4,
      patriots: 12,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 2.5, socialLean: 2.3 } },
    },
  },
  KY: {
    race: { white: 92, black: 7, hispanic: 1, asian: 0, other: 0 },
    education: { no_college: 88, college: 8, graduate: 4 },
    wealth: { low: 40, middle: 47, high: 13 },
    age: { young: 32, mid: 26, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 25,
      environmentalists: 1,
      libertarians: 3,
      progressives: 4,
      patriots: 13,
      gunowners: 19,
    },
    positions: {
      race: { white: { economicLean: 1.4, socialLean: 1.5 } },
    },
  },
  LA: {
    race: { white: 68, black: 29, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 85, college: 10, graduate: 5 },
    wealth: { low: 36, middle: 48, high: 16 },
    age: { young: 35, mid: 26, mature: 23, senior: 16 },
    ideology: {
      evangelicals: 24,
      environmentalists: 1,
      libertarians: 2,
      progressives: 5,
      patriots: 14,
      gunowners: 18,
    },
    positions: {
      race: { white: { economicLean: 3.7, socialLean: 3 } },
    },
  },
  MA: {
    race: { white: 93, black: 4, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 72, college: 18, graduate: 10 },
    wealth: { low: 22, middle: 54, high: 24 },
    age: { young: 31, mid: 26, mature: 24, senior: 19 },
    ideology: {
      evangelicals: 4,
      environmentalists: 9,
      libertarians: 3,
      progressives: 15,
      patriots: 4,
      gunowners: 4,
    },
    positions: {
      race: { white: { economicLean: 0.6, socialLean: 0.1 } },
    },
  },
  MD: {
    race: { white: 74, black: 23, hispanic: 1, asian: 1, other: 1 },
    education: { no_college: 75, college: 16, graduate: 9 },
    wealth: { low: 22, middle: 54, high: 24 },
    age: { young: 32, mid: 28, mature: 24, senior: 16 },
    ideology: {
      evangelicals: 8,
      environmentalists: 6,
      libertarians: 3,
      progressives: 12,
      patriots: 6,
      gunowners: 6,
    },
    positions: {
      race: { white: { economicLean: 1.4, socialLean: 0.9 } },
    },
  },
  ME: {
    race: { white: 98, black: 0, hispanic: 0, asian: 1, other: 1 },
    education: { no_college: 84, college: 11, graduate: 5 },
    wealth: { low: 34, middle: 52, high: 14 },
    age: { young: 29, mid: 25, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 6,
      environmentalists: 7,
      libertarians: 5,
      progressives: 8,
      patriots: 6,
      gunowners: 13,
    },
    positions: {
      race: { white: { economicLean: 1, socialLean: 1.1 } },
    },
  },
  MI: {
    race: { white: 84, black: 13, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 82, college: 12, graduate: 6 },
    wealth: { low: 24, middle: 56, high: 20 },
    age: { young: 33, mid: 27, mature: 24, senior: 16 },
    ideology: {
      evangelicals: 10,
      environmentalists: 4,
      libertarians: 3,
      progressives: 10,
      patriots: 7,
      gunowners: 11,
    },
    positions: {
      race: { white: { economicLean: 1.4, socialLean: 1.3 } },
    },
  },
  MN: {
    race: { white: 96, black: 1, hispanic: 1, asian: 1, other: 1 },
    education: { no_college: 77, college: 16, graduate: 7 },
    wealth: { low: 24, middle: 58, high: 18 },
    age: { young: 32, mid: 27, mature: 23, senior: 18 },
    ideology: {
      evangelicals: 9,
      environmentalists: 6,
      libertarians: 4,
      progressives: 12,
      patriots: 6,
      gunowners: 11,
    },
    positions: {
      race: { white: { economicLean: 0.3, socialLean: 0.3 } },
    },
  },
  MO: {
    race: { white: 88, black: 10, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 83, college: 12, graduate: 5 },
    wealth: { low: 30, middle: 54, high: 16 },
    age: { young: 30, mid: 26, mature: 24, senior: 20 },
    ideology: {
      evangelicals: 18,
      environmentalists: 2,
      libertarians: 4,
      progressives: 6,
      patriots: 11,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 1.5, socialLean: 1.6 } },
    },
  },
  MS: {
    race: { white: 64, black: 35, hispanic: 1, asian: 0, other: 0 },
    education: { no_college: 87, college: 8, graduate: 5 },
    wealth: { low: 44, middle: 44, high: 12 },
    age: { young: 35, mid: 25, mature: 23, senior: 17 },
    ideology: {
      evangelicals: 30,
      environmentalists: 1,
      libertarians: 2,
      progressives: 4,
      patriots: 14,
      gunowners: 19,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 3.7 } },
    },
  },
  MT: {
    race: { white: 93, black: 0, hispanic: 1, asian: 1, other: 5 },
    education: { no_college: 80, college: 14, graduate: 6 },
    wealth: { low: 30, middle: 56, high: 14 },
    age: { young: 32, mid: 26, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 10,
      environmentalists: 5,
      libertarians: 8,
      progressives: 5,
      patriots: 12,
      gunowners: 23,
    },
    positions: {
      race: { white: { economicLean: 2.5, socialLean: 2.3 } },
    },
  },
  NC: {
    race: { white: 75, black: 22, hispanic: 1, asian: 1, other: 1 },
    education: { no_college: 85, college: 10, graduate: 5 },
    wealth: { low: 34, middle: 52, high: 14 },
    age: { young: 33, mid: 27, mature: 23, senior: 17 },
    ideology: {
      evangelicals: 26,
      environmentalists: 2,
      libertarians: 2,
      progressives: 5,
      patriots: 13,
      gunowners: 16,
    },
    positions: {
      race: { white: { economicLean: 2.5, socialLean: 2.1 } },
    },
  },
  ND: {
    race: { white: 95, black: 0, hispanic: 1, asian: 0, other: 4 },
    education: { no_college: 82, college: 13, graduate: 5 },
    wealth: { low: 28, middle: 58, high: 14 },
    age: { young: 33, mid: 25, mature: 22, senior: 20 },
    ideology: {
      evangelicals: 12,
      environmentalists: 2,
      libertarians: 5,
      progressives: 5,
      patriots: 11,
      gunowners: 16,
    },
    positions: {
      race: { white: { economicLean: 3.2, socialLean: 2.7 } },
    },
  },
  NE: {
    race: { white: 94, black: 3, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 81, college: 14, graduate: 5 },
    wealth: { low: 26, middle: 58, high: 16 },
    age: { young: 31, mid: 25, mature: 23, senior: 21 },
    ideology: {
      evangelicals: 14,
      environmentalists: 2,
      libertarians: 5,
      progressives: 4,
      patriots: 11,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 3.2, socialLean: 2.7 } },
    },
  },
  NH: {
    race: { white: 98, black: 0, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 77, college: 16, graduate: 7 },
    wealth: { low: 24, middle: 56, high: 20 },
    age: { young: 31, mid: 27, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 5,
      environmentalists: 6,
      libertarians: 8,
      progressives: 7,
      patriots: 7,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 2.5, socialLean: 2 } },
    },
  },
  NJ: {
    race: { white: 79, black: 13, hispanic: 7, asian: 1, other: 0 },
    education: { no_college: 76, college: 16, graduate: 8 },
    wealth: { low: 20, middle: 52, high: 28 },
    age: { young: 30, mid: 26, mature: 26, senior: 18 },
    ideology: {
      evangelicals: 5,
      environmentalists: 6,
      libertarians: 3,
      progressives: 12,
      patriots: 6,
      gunowners: 5,
    },
    positions: {
      race: { white: { economicLean: 1.8, socialLean: 0.9 } },
    },
  },
  NM: {
    race: { white: 52, black: 2, hispanic: 37, asian: 1, other: 8 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 36, middle: 50, high: 14 },
    age: { young: 35, mid: 26, mature: 23, senior: 16 },
    ideology: {
      evangelicals: 10,
      environmentalists: 4,
      libertarians: 5,
      progressives: 8,
      patriots: 9,
      gunowners: 15,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 3.2 } },
    },
  },
  NV: {
    race: { white: 85, black: 6, hispanic: 7, asian: 1, other: 1 },
    education: { no_college: 81, college: 13, graduate: 6 },
    wealth: { low: 24, middle: 56, high: 20 },
    age: { young: 32, mid: 28, mature: 24, senior: 16 },
    ideology: {
      evangelicals: 8,
      environmentalists: 3,
      libertarians: 10,
      progressives: 5,
      patriots: 9,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 3.4, socialLean: 2.7 } },
    },
  },
  NY: {
    race: { white: 75, black: 14, hispanic: 9, asian: 2, other: 0 },
    education: { no_college: 75, college: 16, graduate: 9 },
    wealth: { low: 28, middle: 50, high: 22 },
    age: { young: 31, mid: 26, mature: 25, senior: 18 },
    ideology: {
      evangelicals: 5,
      environmentalists: 7,
      libertarians: 3,
      progressives: 15,
      patriots: 5,
      gunowners: 6,
    },
    positions: {
      race: { white: { economicLean: 1.8, socialLean: 0.9 } },
    },
  },
  OH: {
    race: { white: 88, black: 10, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 83, college: 12, graduate: 5 },
    wealth: { low: 24, middle: 58, high: 18 },
    age: { young: 32, mid: 26, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 12,
      environmentalists: 3,
      libertarians: 3,
      progressives: 8,
      patriots: 9,
      gunowners: 11,
    },
    positions: {
      race: { white: { economicLean: 1.5, socialLean: 1.6 } },
    },
  },
  OK: {
    race: { white: 83, black: 7, hispanic: 2, asian: 1, other: 7 },
    education: { no_college: 82, college: 13, graduate: 5 },
    wealth: { low: 30, middle: 54, high: 16 },
    age: { young: 31, mid: 26, mature: 23, senior: 20 },
    ideology: {
      evangelicals: 26,
      environmentalists: 1,
      libertarians: 5,
      progressives: 3,
      patriots: 14,
      gunowners: 18,
    },
    positions: {
      race: { white: { economicLean: 3.1, socialLean: 2.7 } },
    },
  },
  OR: {
    race: { white: 93, black: 1, hispanic: 3, asian: 2, other: 1 },
    education: { no_college: 77, college: 16, graduate: 7 },
    wealth: { low: 26, middle: 58, high: 16 },
    age: { young: 31, mid: 27, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 9,
      environmentalists: 10,
      libertarians: 6,
      progressives: 10,
      patriots: 7,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 1.3, socialLean: 1.1 } },
    },
  },
  PA: {
    race: { white: 89, black: 9, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 83, college: 11, graduate: 6 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 29, mid: 25, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 9,
      environmentalists: 3,
      libertarians: 3,
      progressives: 9,
      patriots: 8,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 1.1, socialLean: 1.2 } },
    },
  },
  RI: {
    race: { white: 94, black: 3, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 80, college: 13, graduate: 7 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 30, mid: 25, mature: 25, senior: 20 },
    ideology: {
      evangelicals: 4,
      environmentalists: 6,
      libertarians: 3,
      progressives: 13,
      patriots: 5,
      gunowners: 5,
    },
    positions: {
      race: { white: { economicLean: -0.1, socialLean: -0.3 } },
    },
  },
  SC: {
    race: { white: 68, black: 30, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 85, college: 10, graduate: 5 },
    wealth: { low: 38, middle: 48, high: 14 },
    age: { young: 35, mid: 27, mature: 22, senior: 16 },
    ideology: {
      evangelicals: 28,
      environmentalists: 1,
      libertarians: 2,
      progressives: 4,
      patriots: 15,
      gunowners: 17,
    },
    positions: {
      race: { white: { economicLean: 3.5, socialLean: 2.9 } },
    },
  },
  SD: {
    race: { white: 92, black: 0, hispanic: 1, asian: 0, other: 7 },
    education: { no_college: 83, college: 12, graduate: 5 },
    wealth: { low: 32, middle: 54, high: 14 },
    age: { young: 32, mid: 25, mature: 22, senior: 21 },
    ideology: {
      evangelicals: 14,
      environmentalists: 2,
      libertarians: 5,
      progressives: 4,
      patriots: 12,
      gunowners: 17,
    },
    positions: {
      race: { white: { economicLean: 3, socialLean: 2.6 } },
    },
  },
  TN: {
    race: { white: 83, black: 16, hispanic: 1, asian: 0, other: 0 },
    education: { no_college: 86, college: 9, graduate: 5 },
    wealth: { low: 36, middle: 50, high: 14 },
    age: { young: 32, mid: 26, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 29,
      environmentalists: 1,
      libertarians: 3,
      progressives: 4,
      patriots: 14,
      gunowners: 18,
    },
    positions: {
      race: { white: { economicLean: 1.8, socialLean: 2 } },
    },
  },
  TX: {
    race: { white: 66, black: 12, hispanic: 21, asian: 1, other: 0 },
    education: { no_college: 81, college: 13, graduate: 6 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 35, mid: 27, mature: 22, senior: 16 },
    ideology: {
      evangelicals: 22,
      environmentalists: 1,
      libertarians: 5,
      progressives: 4,
      patriots: 14,
      gunowners: 17,
    },
    positions: {
      race: { white: { economicLean: 3.9, socialLean: 2.9 } },
    },
  },
  UT: {
    race: { white: 93, black: 1, hispanic: 4, asian: 1, other: 1 },
    education: { no_college: 76, college: 17, graduate: 7 },
    wealth: { low: 24, middle: 60, high: 16 },
    age: { young: 42, mid: 25, mature: 19, senior: 14 },
    ideology: {
      evangelicals: 26,
      environmentalists: 2,
      libertarians: 7,
      progressives: 3,
      patriots: 12,
      gunowners: 13,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 3.9 } },
    },
  },
  VA: {
    race: { white: 79, black: 19, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 28, middle: 52, high: 20 },
    age: { young: 33, mid: 28, mature: 23, senior: 16 },
    ideology: {
      evangelicals: 20,
      environmentalists: 3,
      libertarians: 3,
      progressives: 6,
      patriots: 13,
      gunowners: 13,
    },
    positions: {
      race: { white: { economicLean: 2.7, socialLean: 2.3 } },
    },
  },
  VT: {
    race: { white: 98, black: 0, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 78, college: 15, graduate: 7 },
    wealth: { low: 32, middle: 54, high: 14 },
    age: { young: 32, mid: 26, mature: 23, senior: 19 },
    ideology: {
      evangelicals: 5,
      environmentalists: 10,
      libertarians: 5,
      progressives: 11,
      patriots: 5,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 1.3, socialLean: 0.4 } },
    },
  },
  WA: {
    race: { white: 90, black: 3, hispanic: 3, asian: 3, other: 1 },
    education: { no_college: 75, college: 17, graduate: 8 },
    wealth: { low: 24, middle: 58, high: 18 },
    age: { young: 32, mid: 27, mature: 23, senior: 18 },
    ideology: {
      evangelicals: 8,
      environmentalists: 10,
      libertarians: 5,
      progressives: 11,
      patriots: 7,
      gunowners: 11,
    },
    positions: {
      race: { white: { economicLean: 1.7, socialLean: 1.3 } },
    },
  },
  WI: {
    race: { white: 94, black: 4, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 81, college: 13, graduate: 6 },
    wealth: { low: 24, middle: 60, high: 16 },
    age: { young: 32, mid: 26, mature: 23, senior: 19 },
    ideology: {
      evangelicals: 9,
      environmentalists: 5,
      libertarians: 4,
      progressives: 11,
      patriots: 7,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 0.8, socialLean: 1 } },
    },
  },
  WV: {
    race: { white: 96, black: 3, hispanic: 1, asian: 0, other: 0 },
    education: { no_college: 89, college: 7, graduate: 4 },
    wealth: { low: 42, middle: 46, high: 12 },
    age: { young: 29, mid: 25, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 22,
      environmentalists: 1,
      libertarians: 2,
      progressives: 6,
      patriots: 11,
      gunowners: 18,
    },
    positions: {
      // Union coal country: econ-left (UMWA Democrats), social-right.
      race: { white: { economicLean: 4.5, socialLean: 3 } },
      education: { no_college: { economicLean: -2.5, socialLean: 0.5 } },
      age: {
        mid: { economicLean: -1.0, socialLean: -0.5 },
        mature: { economicLean: -1.5, socialLean: 0.5 },
        senior: { economicLean: -2.0, socialLean: 0.5 }, // New Deal / mine-pension loyalty
      },
      wealth: { middle: { economicLean: -1.5, socialLean: 0.0 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 4.0 },
        patriots: { economicLean: 1.5, socialLean: 3.0 },
        gunowners: { economicLean: 1.0, socialLean: 2.5 }, // NRA Democrats
      },
    },
  },
  WY: {
    race: { white: 92, black: 1, hispanic: 5, asian: 1, other: 1 },
    education: { no_college: 79, college: 15, graduate: 6 },
    wealth: { low: 22, middle: 58, high: 20 },
    age: { young: 36, mid: 28, mature: 22, senior: 14 },
    ideology: {
      evangelicals: 13,
      environmentalists: 3,
      libertarians: 11,
      progressives: 3,
      patriots: 14,
      gunowners: 24,
    },
    positions: {
      race: { white: { economicLean: 2.9, socialLean: 2.9 } },
    },
  },
};
