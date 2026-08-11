import type { Layer1Config } from "./stateDemographics";

/**
 * 1991-era US state census profiles — independently authored, anchored to the
 * 1990 Census (not derived from the 2019 data in `stateCensusData.ts`).
 *
 * Used both for the region-page census display and for seed-time Layer-1
 * demographic generation under the `1991-default` preset.
 *
 * Methodology: each state was hand-authored from 1990 Census tabulations and
 * period political history rather than scaled from 2019 values.
 *
 * National reference points (1990 Census):
 * - Race: non-Hispanic White ~76-80%, Black ~12%, Hispanic ~9%, Asian ~3%.
 * - Education: bachelor's degree or higher ~20% of adults (graduate ~7%).
 * - Median age ~32.8 — markedly younger than 2019; seniors a smaller share.
 * - Ideology coding reflects the immediate post-Cold-War moment: evangelical
 *   mobilization at high tide across the South (Moral Majority aftermath),
 *   Gulf War patriotism elevated, environmentalists a modest post-Earth-Day-
 *   1990 presence, progressives far smaller than 2019, Reagan-Democrat
 *   blue-collar identity strong in the industrial Midwest, California still
 *   purple-ish (it voted GOP in every presidential race 1968-1988), and the
 *   Deep South's partisan realignment still in progress (Democratic
 *   governors/legislatures atop culturally conservative electorates).
 * - Ideology values are independent group shares and do NOT sum to 100;
 *   the scale conventions match the 2019 file.
 */
export const stateCensusData1991: Record<string, Layer1Config> = {
  // ---- Northeast ----
  CT: {
    race: { white: 84, black: 8, hispanic: 6, asian: 2, other: 0 },
    education: { no_college: 73, college: 18, graduate: 9 },
    wealth: { low: 18, middle: 54, high: 28 },
    age: { young: 27, mid: 27, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 6,
      environmentalists: 10,
      libertarians: 4,
      progressives: 11,
      patriots: 7,
      gunowners: 6,
    },
    positions: {
      race: { white: { economicLean: 2.4, socialLean: 1.2 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.0, socialLean: 0.0 },
        gunowners: { economicLean: 0.5, socialLean: 0.5 },
        progressives: { economicLean: -4.0, socialLean: -4.0 },
      },
      education: {
        no_college: { economicLean: -0.5, socialLean: -0.5 },
      },
      wealth: {
        middle: { economicLean: -0.5, socialLean: -0.5 },
      },
      age: {
        senior: { economicLean: -0.5, socialLean: -0.5 },
      },
    },
  },
  DE: {
    race: { white: 79, black: 17, hispanic: 2, asian: 1, other: 1 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 22, middle: 56, high: 22 },
    age: { young: 28, mid: 26, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 10,
      environmentalists: 8,
      libertarians: 4,
      progressives: 9,
      patriots: 8,
      gunowners: 8,
    },
    positions: {
      race: { white: { economicLean: 3.7, socialLean: 2.5 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.0, socialLean: 0.0 },
        gunowners: { economicLean: 0.5, socialLean: 0.5 },
        progressives: { economicLean: -4.0, socialLean: -4.0 },
      },
      education: {
        no_college: { economicLean: -0.5, socialLean: -0.5 },
      },
      wealth: {
        middle: { economicLean: -0.5, socialLean: -0.5 },
      },
      age: {
        senior: { economicLean: -0.5, socialLean: -0.5 },
      },
    },
  },
  MA: {
    race: { white: 88, black: 5, hispanic: 5, asian: 2, other: 0 },
    education: { no_college: 73, college: 18, graduate: 9 },
    wealth: { low: 22, middle: 53, high: 25 },
    age: { young: 28, mid: 27, mature: 25, senior: 20 },
    ideology: {
      evangelicals: 4,
      environmentalists: 11,
      libertarians: 4,
      progressives: 14,
      patriots: 6,
      gunowners: 4,
    },
    positions: {
      race: { white: { economicLean: 2.3, socialLean: 1 } },
      ideology: {
        evangelicals: { economicLean: 0.0, socialLean: 0.0 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
        progressives: { economicLean: -4.5, socialLean: -4.5 },
      },
      education: {
        no_college: { economicLean: -1.0, socialLean: -1.0 },
      },
      wealth: {
        middle: { economicLean: -1.0, socialLean: -1.0 },
      },
      age: {
        senior: { economicLean: -1.0, socialLean: -1.0 },
      },
    },
  },
  MD: {
    race: { white: 69, black: 25, hispanic: 3, asian: 3, other: 0 },
    education: { no_college: 74, college: 17, graduate: 9 },
    wealth: { low: 20, middle: 55, high: 25 },
    age: { young: 28, mid: 28, mature: 26, senior: 18 },
    ideology: {
      evangelicals: 9,
      environmentalists: 9,
      libertarians: 4,
      progressives: 12,
      patriots: 7,
      gunowners: 7,
    },
    positions: {
      race: { white: { economicLean: 3.8, socialLean: 2.4 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.0, socialLean: 0.0 },
        gunowners: { economicLean: 0.5, socialLean: 0.5 },
        progressives: { economicLean: -4.0, socialLean: -4.0 },
      },
      education: {
        no_college: { economicLean: -0.5, socialLean: -0.5 },
      },
      wealth: {
        middle: { economicLean: -0.5, socialLean: -0.5 },
      },
      age: {
        senior: { economicLean: -0.5, socialLean: -0.5 },
      },
    },
  },
  ME: {
    race: { white: 97, black: 1, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 81, college: 13, graduate: 6 },
    wealth: { low: 28, middle: 56, high: 16 },
    age: { young: 26, mid: 26, mature: 27, senior: 21 },
    ideology: {
      evangelicals: 7,
      environmentalists: 11,
      libertarians: 7,
      progressives: 8,
      patriots: 8,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 2.7, socialLean: 1.4 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.0, socialLean: 0.0 },
        gunowners: { economicLean: 0.5, socialLean: 0.5 },
        progressives: { economicLean: -4.0, socialLean: -4.0 },
      },
      education: {
        no_college: { economicLean: -0.5, socialLean: -0.5 },
      },
      wealth: {
        middle: { economicLean: -0.5, socialLean: -0.5 },
      },
      age: {
        senior: { economicLean: -0.5, socialLean: -0.5 },
      },
    },
  },
  NH: {
    race: { white: 97, black: 1, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 76, college: 16, graduate: 8 },
    wealth: { low: 18, middle: 60, high: 22 },
    age: { young: 27, mid: 28, mature: 27, senior: 18 },
    ideology: {
      evangelicals: 7,
      environmentalists: 9,
      libertarians: 11,
      progressives: 7,
      patriots: 9,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 3.4, socialLean: 1.8 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.0, socialLean: 0.0 },
        gunowners: { economicLean: 0.5, socialLean: 0.5 },
        progressives: { economicLean: -4.0, socialLean: -4.0 },
      },
      education: {
        no_college: { economicLean: -0.5, socialLean: -0.5 },
      },
      wealth: {
        middle: { economicLean: -0.5, socialLean: -0.5 },
      },
      age: {
        senior: { economicLean: -0.5, socialLean: -0.5 },
      },
    },
  },
  NJ: {
    race: { white: 74, black: 13, hispanic: 10, asian: 3, other: 0 },
    education: { no_college: 75, college: 17, graduate: 8 },
    wealth: { low: 20, middle: 53, high: 27 },
    age: { young: 27, mid: 27, mature: 27, senior: 19 },
    ideology: {
      evangelicals: 6,
      environmentalists: 9,
      libertarians: 4,
      progressives: 11,
      patriots: 8,
      gunowners: 6,
    },
    positions: {
      race: { white: { economicLean: 3.9, socialLean: 2.1 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.0, socialLean: 0.0 },
        gunowners: { economicLean: 0.5, socialLean: 0.5 },
        progressives: { economicLean: -4.0, socialLean: -4.0 },
      },
      education: {
        no_college: { economicLean: -0.5, socialLean: -0.5 },
      },
      wealth: {
        middle: { economicLean: -0.5, socialLean: -0.5 },
      },
      age: {
        senior: { economicLean: -0.5, socialLean: -0.5 },
      },
    },
  },
  NY: {
    race: { white: 69, black: 14, hispanic: 12, asian: 4, other: 1 },
    education: { no_college: 77, college: 15, graduate: 8 },
    wealth: { low: 28, middle: 50, high: 22 },
    age: { young: 28, mid: 27, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 7,
      environmentalists: 9,
      libertarians: 4,
      progressives: 13,
      patriots: 7,
      gunowners: 7,
    },
    positions: {
      race: { white: { economicLean: 4.1, socialLean: 2.6 } },
      ideology: {
        evangelicals: { economicLean: 0.0, socialLean: 0.0 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
        progressives: { economicLean: -4.5, socialLean: -4.5 },
      },
      education: {
        no_college: { economicLean: -1.0, socialLean: -1.0 },
      },
      wealth: {
        middle: { economicLean: -1.0, socialLean: -1.0 },
      },
      age: {
        senior: { economicLean: -1.0, socialLean: -1.0 },
      },
    },
  },
  PA: {
    race: { white: 88, black: 9, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 82, college: 12, graduate: 6 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 25, mid: 25, mature: 27, senior: 23 },
    ideology: {
      evangelicals: 13,
      environmentalists: 6,
      libertarians: 5,
      progressives: 7,
      patriots: 12,
      gunowners: 15,
    },
    positions: {
      race: { white: { economicLean: 2.4, socialLean: 1.7 } },
      ideology: {
        evangelicals: { economicLean: 1.5, socialLean: 1.5 },
        patriots: { economicLean: 1.0, socialLean: 1.0 },
        gunowners: { economicLean: 1.5, socialLean: 1.5 },
        progressives: { economicLean: -3.0, socialLean: -3.0 },
      },
      education: {
        no_college: { economicLean: -0.5, socialLean: -0.5 },
      },
      wealth: {
        middle: { economicLean: -0.5, socialLean: -0.5 },
      },
      age: {
        senior: { economicLean: -0.5, socialLean: -0.5 },
      },
    },
  },
  RI: {
    race: { white: 89, black: 4, hispanic: 5, asian: 2, other: 0 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 26, middle: 55, high: 19 },
    age: { young: 27, mid: 26, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 4,
      environmentalists: 9,
      libertarians: 4,
      progressives: 12,
      patriots: 7,
      gunowners: 5,
    },
    positions: {
      race: { white: { economicLean: 2.1, socialLean: 0.9 } },
      ideology: {
        evangelicals: { economicLean: 0.0, socialLean: 0.0 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
        progressives: { economicLean: -4.5, socialLean: -4.5 },
      },
      education: {
        no_college: { economicLean: -1.0, socialLean: -1.0 },
      },
      wealth: {
        middle: { economicLean: -1.0, socialLean: -1.0 },
      },
      age: {
        senior: { economicLean: -1.0, socialLean: -1.0 },
      },
    },
  },
  VT: {
    race: { white: 97, black: 1, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 76, college: 16, graduate: 8 },
    wealth: { low: 26, middle: 58, high: 16 },
    age: { young: 28, mid: 27, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 5,
      environmentalists: 14,
      libertarians: 7,
      progressives: 12,
      patriots: 6,
      gunowners: 10,
    },
    positions: {
      race: { white: { economicLean: 3.1, socialLean: 1.3 } },
      ideology: {
        evangelicals: { economicLean: 0.0, socialLean: 0.0 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
        progressives: { economicLean: -4.5, socialLean: -4.5 },
      },
      education: {
        no_college: { economicLean: -1.0, socialLean: -1.0 },
      },
      wealth: {
        middle: { economicLean: -1.0, socialLean: -1.0 },
      },
      age: {
        senior: { economicLean: -1.0, socialLean: -1.0 },
      },
    },
  },

  // ---- South ----
  AL: {
    race: { white: 73, black: 25, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 84, college: 11, graduate: 5 },
    wealth: { low: 36, middle: 52, high: 12 },
    age: { young: 28, mid: 26, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 44,
      environmentalists: 1,
      libertarians: 3,
      progressives: 3,
      patriots: 19,
      gunowners: 24,
    },
    positions: {
      race: { white: { economicLean: 2.8, socialLean: 2.8 } },
      ideology: {
        evangelicals: { economicLean: 3.5, socialLean: 3.5 },
        patriots: { economicLean: 3.0, socialLean: 3.0 },
        gunowners: { economicLean: 3.0, socialLean: 3.0 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 1.0, socialLean: 1.0 },
      },
      wealth: {
        middle: { economicLean: 1.0, socialLean: 1.0 },
      },
      age: {
        senior: { economicLean: 1.0, socialLean: 1.0 },
      },
    },
  },
  AR: {
    race: { white: 82, black: 16, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 87, college: 9, graduate: 4 },
    wealth: { low: 38, middle: 51, high: 11 },
    age: { young: 27, mid: 25, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 42,
      environmentalists: 1,
      libertarians: 4,
      progressives: 3,
      patriots: 18,
      gunowners: 23,
    },
    positions: {
      // Clinton's home state: favorite-son pull drags working/middle class
      // toward the Democrats, but rural social conservatism keeps net lean
      // just right of center.
      race: { white: { economicLean: 4.5, socialLean: 3 } },
      ideology: {
        evangelicals: { economicLean: 1.5, socialLean: 1.5 },
        patriots: { economicLean: 1.0, socialLean: 1.0 },
        gunowners: { economicLean: 1.5, socialLean: 1.5 },
        progressives: { economicLean: -3.0, socialLean: -3.0 },
      },
      education: {
        no_college: { economicLean: -1.5, socialLean: -0.5 },
      },
      wealth: {
        middle: { economicLean: -1.0, socialLean: -1.0 },
      },
      age: {
        senior: { economicLean: -1.0, socialLean: -1.0 },
      },
    },
  },
  FL: {
    race: { white: 73, black: 13, hispanic: 12, asian: 1, other: 1 },
    education: { no_college: 82, college: 12, graduate: 6 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 22, mid: 23, mature: 26, senior: 29 },
    ideology: {
      evangelicals: 18,
      environmentalists: 6,
      libertarians: 6,
      progressives: 6,
      patriots: 13,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 2.8, socialLean: 2.4 } },
      ideology: {
        evangelicals: { economicLean: 2.0, socialLean: 2.0 },
        patriots: { economicLean: 1.5, socialLean: 1.5 },
        gunowners: { economicLean: 2.0, socialLean: 2.0 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 0.5, socialLean: 0.5 },
      },
      wealth: {
        middle: { economicLean: 0.5, socialLean: 0.5 },
      },
      age: {
        senior: { economicLean: 0.5, socialLean: 0.5 },
      },
    },
  },
  GA: {
    race: { white: 70, black: 27, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 81, college: 13, graduate: 6 },
    wealth: { low: 30, middle: 54, high: 16 },
    age: { young: 30, mid: 28, mature: 25, senior: 17 },
    ideology: {
      evangelicals: 36,
      environmentalists: 2,
      libertarians: 4,
      progressives: 5,
      patriots: 16,
      gunowners: 19,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 3 } },
      ideology: {
        evangelicals: { economicLean: 2.0, socialLean: 2.0 },
        patriots: { economicLean: 1.5, socialLean: 1.5 },
        gunowners: { economicLean: 2.0, socialLean: 2.0 },
        progressives: { economicLean: -2.5, socialLean: -2.5 },
      },
      education: {
        no_college: { economicLean: 0.0, socialLean: 0.0 },
      },
      wealth: {
        middle: { economicLean: 0.0, socialLean: 0.0 },
      },
      age: {
        senior: { economicLean: 0.0, socialLean: 0.0 },
      },
    },
  },
  KY: {
    race: { white: 91, black: 7, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 86, college: 9, graduate: 5 },
    wealth: { low: 36, middle: 52, high: 12 },
    age: { young: 28, mid: 26, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 32,
      environmentalists: 2,
      libertarians: 5,
      progressives: 4,
      patriots: 15,
      gunowners: 21,
    },
    positions: {
      race: { white: { economicLean: 2.5, socialLean: 1.8 } },
      ideology: {
        evangelicals: { economicLean: 2.0, socialLean: 2.0 },
        patriots: { economicLean: 1.5, socialLean: 1.5 },
        gunowners: { economicLean: 2.0, socialLean: 2.0 },
        progressives: { economicLean: -2.5, socialLean: -2.5 },
      },
      education: {
        no_college: { economicLean: 0.0, socialLean: 0.0 },
      },
      wealth: {
        middle: { economicLean: 0.0, socialLean: 0.0 },
      },
      age: {
        senior: { economicLean: 0.0, socialLean: 0.0 },
      },
    },
  },
  LA: {
    race: { white: 66, black: 31, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 84, college: 11, graduate: 5 },
    wealth: { low: 38, middle: 50, high: 12 },
    age: { young: 30, mid: 27, mature: 25, senior: 18 },
    ideology: {
      evangelicals: 34,
      environmentalists: 2,
      libertarians: 4,
      progressives: 5,
      patriots: 16,
      gunowners: 19,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 3 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 2.5 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.5, socialLean: -2.5 },
      },
      education: {
        no_college: { economicLean: 0.0, socialLean: 0.0 },
      },
      wealth: {
        middle: { economicLean: 0.0, socialLean: 0.0 },
      },
      age: {
        senior: { economicLean: 0.0, socialLean: 0.0 },
      },
    },
  },
  MS: {
    race: { white: 63, black: 35, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 85, college: 10, graduate: 5 },
    wealth: { low: 42, middle: 48, high: 10 },
    age: { young: 30, mid: 26, mature: 25, senior: 19 },
    ideology: {
      evangelicals: 44,
      environmentalists: 1,
      libertarians: 3,
      progressives: 4,
      patriots: 17,
      gunowners: 21,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 3.8 } },
      ideology: {
        evangelicals: { economicLean: 3.5, socialLean: 3.5 },
        patriots: { economicLean: 3.0, socialLean: 3.0 },
        gunowners: { economicLean: 3.0, socialLean: 3.0 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 1.0, socialLean: 1.0 },
      },
      wealth: {
        middle: { economicLean: 1.0, socialLean: 1.0 },
      },
      age: {
        senior: { economicLean: 1.0, socialLean: 1.0 },
      },
    },
  },
  NC: {
    race: { white: 75, black: 22, hispanic: 1, asian: 1, other: 1 },
    education: { no_college: 82, college: 12, graduate: 6 },
    wealth: { low: 30, middle: 55, high: 15 },
    age: { young: 28, mid: 27, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 34,
      environmentalists: 3,
      libertarians: 4,
      progressives: 5,
      patriots: 15,
      gunowners: 18,
    },
    positions: {
      race: { white: { economicLean: 3, socialLean: 2.3 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 2.5 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 0.5, socialLean: 0.5 },
      },
      wealth: {
        middle: { economicLean: 0.5, socialLean: 0.5 },
      },
      age: {
        senior: { economicLean: 0.5, socialLean: 0.5 },
      },
    },
  },
  SC: {
    race: { white: 68, black: 30, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 83, college: 11, graduate: 6 },
    wealth: { low: 33, middle: 53, high: 14 },
    age: { young: 29, mid: 27, mature: 26, senior: 18 },
    ideology: {
      evangelicals: 38,
      environmentalists: 2,
      libertarians: 4,
      progressives: 4,
      patriots: 17,
      gunowners: 20,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 3.8 } },
      ideology: {
        evangelicals: { economicLean: 3.0, socialLean: 3.0 },
        patriots: { economicLean: 2.5, socialLean: 2.5 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 0.5, socialLean: 0.5 },
      },
      wealth: {
        middle: { economicLean: 0.5, socialLean: 0.5 },
      },
      age: {
        senior: { economicLean: 0.5, socialLean: 0.5 },
      },
    },
  },
  TN: {
    race: { white: 82, black: 16, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 84, college: 11, graduate: 5 },
    wealth: { low: 33, middle: 53, high: 14 },
    age: { young: 28, mid: 27, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 38,
      environmentalists: 2,
      libertarians: 4,
      progressives: 4,
      patriots: 16,
      gunowners: 21,
    },
    positions: {
      race: { white: { economicLean: 3.4, socialLean: 2.4 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 2.5 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 0.0, socialLean: 0.0 },
      },
      wealth: {
        middle: { economicLean: 0.0, socialLean: 0.0 },
      },
      age: {
        senior: { economicLean: 0.0, socialLean: 0.0 },
      },
    },
  },
  VA: {
    race: { white: 76, black: 19, hispanic: 3, asian: 2, other: 0 },
    education: { no_college: 76, college: 16, graduate: 8 },
    wealth: { low: 24, middle: 55, high: 21 },
    age: { young: 29, mid: 28, mature: 26, senior: 17 },
    ideology: {
      evangelicals: 22,
      environmentalists: 5,
      libertarians: 5,
      progressives: 7,
      patriots: 14,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 3, socialLean: 2.5 } },
      ideology: {
        evangelicals: { economicLean: 2.0, socialLean: 2.0 },
        patriots: { economicLean: 1.5, socialLean: 1.5 },
        gunowners: { economicLean: 2.0, socialLean: 2.0 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 0.5, socialLean: 0.5 },
      },
      wealth: {
        middle: { economicLean: 0.5, socialLean: 0.5 },
      },
      age: {
        senior: { economicLean: 0.5, socialLean: 0.5 },
      },
    },
  },
  WV: {
    race: { white: 96, black: 3, hispanic: 1, asian: 0, other: 0 },
    education: { no_college: 88, college: 8, graduate: 4 },
    wealth: { low: 42, middle: 48, high: 10 },
    age: { young: 25, mid: 24, mature: 27, senior: 24 },
    ideology: {
      evangelicals: 26,
      environmentalists: 2,
      libertarians: 4,
      progressives: 4,
      patriots: 15,
      gunowners: 22,
    },
    positions: {
      // Transition-era WV: still union-Democratic on economics but socially
      // right; net lean tips right of center (legacy model has WV clearly red).
      race: { white: { economicLean: 2, socialLean: 1.9 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 3.5 },
        patriots: { economicLean: 2.0, socialLean: 2.5 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -4.0, socialLean: -4.0 },
      },
      education: {
        no_college: { economicLean: -0.5, socialLean: 1.0 }, // coal econ-left, social-right
      },
      wealth: {
        middle: { economicLean: 0.0, socialLean: 0.5 },
      },
      age: {
        senior: { economicLean: -0.5, socialLean: 1.0 }, // UMWA pension loyalty fading
      },
    },
  },

  // ---- Midwest ----
  IA: {
    race: { white: 95, black: 2, hispanic: 1, asian: 1, other: 1 },
    education: { no_college: 83, college: 12, graduate: 5 },
    wealth: { low: 26, middle: 60, high: 14 },
    age: { young: 26, mid: 25, mature: 26, senior: 23 },
    ideology: {
      evangelicals: 17,
      environmentalists: 5,
      libertarians: 6,
      progressives: 6,
      patriots: 12,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 1.1, socialLean: 1 } },
      ideology: {
        evangelicals: { economicLean: 1.5, socialLean: 1.5 },
        patriots: { economicLean: 1.0, socialLean: 1.0 },
        gunowners: { economicLean: 1.5, socialLean: 1.5 },
        progressives: { economicLean: -3.0, socialLean: -3.0 },
      },
      education: {
        no_college: { economicLean: -0.5, socialLean: -0.5 },
      },
      wealth: {
        middle: { economicLean: -0.5, socialLean: -0.5 },
      },
      age: {
        senior: { economicLean: -0.5, socialLean: -0.5 },
      },
    },
  },
  IL: {
    race: { white: 75, black: 15, hispanic: 8, asian: 2, other: 0 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 26, middle: 54, high: 20 },
    age: { young: 28, mid: 27, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 12,
      environmentalists: 7,
      libertarians: 5,
      progressives: 10,
      patriots: 9,
      gunowners: 9,
    },
    positions: {
      race: { white: { economicLean: 3.4, socialLean: 2.3 } },
      ideology: {
        evangelicals: { economicLean: 1.5, socialLean: 1.5 },
        patriots: { economicLean: 1.0, socialLean: 1.0 },
        gunowners: { economicLean: 1.0, socialLean: 1.0 },
        progressives: { economicLean: -3.0, socialLean: -3.0 },
      },
      education: {
        no_college: { economicLean: -0.5, socialLean: -0.5 },
      },
      wealth: {
        middle: { economicLean: -0.5, socialLean: -0.5 },
      },
      age: {
        senior: { economicLean: -0.5, socialLean: -0.5 },
      },
    },
  },
  IN: {
    race: { white: 89, black: 8, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 84, college: 11, graduate: 5 },
    wealth: { low: 28, middle: 58, high: 14 },
    age: { young: 28, mid: 26, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 24,
      environmentalists: 3,
      libertarians: 6,
      progressives: 5,
      patriots: 14,
      gunowners: 17,
    },
    positions: {
      race: { white: { economicLean: 1.2, socialLean: 1.6 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 2.5 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 1.0, socialLean: 1.0 },
      },
      wealth: {
        middle: { economicLean: 1.0, socialLean: 1.0 },
      },
      age: {
        senior: { economicLean: 1.0, socialLean: 1.0 },
      },
    },
  },
  KS: {
    race: { white: 88, black: 6, hispanic: 4, asian: 1, other: 1 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 26, middle: 58, high: 16 },
    age: { young: 28, mid: 26, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 24,
      environmentalists: 3,
      libertarians: 8,
      progressives: 5,
      patriots: 13,
      gunowners: 16,
    },
    positions: {
      race: { white: { economicLean: 0.8, socialLean: 1.6 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 2.5 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 1.0, socialLean: 1.0 },
      },
      wealth: {
        middle: { economicLean: 1.0, socialLean: 1.0 },
      },
      age: {
        senior: { economicLean: 1.0, socialLean: 1.0 },
      },
    },
  },
  MI: {
    race: { white: 82, black: 14, hispanic: 2, asian: 1, other: 1 },
    education: { no_college: 83, college: 11, graduate: 6 },
    wealth: { low: 28, middle: 55, high: 17 },
    age: { young: 28, mid: 27, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 15,
      environmentalists: 6,
      libertarians: 5,
      progressives: 8,
      patriots: 11,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 3.4, socialLean: 2.3 } },
      ideology: {
        evangelicals: { economicLean: 1.5, socialLean: 1.5 },
        patriots: { economicLean: 1.0, socialLean: 1.0 },
        gunowners: { economicLean: 1.5, socialLean: 1.5 },
        progressives: { economicLean: -3.0, socialLean: -3.0 },
      },
      education: {
        no_college: { economicLean: -0.5, socialLean: -0.5 },
      },
      wealth: {
        middle: { economicLean: -0.5, socialLean: -0.5 },
      },
      age: {
        senior: { economicLean: -0.5, socialLean: -0.5 },
      },
    },
  },
  MN: {
    race: { white: 93, black: 2, hispanic: 1, asian: 2, other: 2 },
    education: { no_college: 78, college: 15, graduate: 7 },
    wealth: { low: 24, middle: 59, high: 17 },
    age: { young: 28, mid: 27, mature: 25, senior: 20 },
    ideology: {
      evangelicals: 12,
      environmentalists: 9,
      libertarians: 5,
      progressives: 11,
      patriots: 8,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 2.3, socialLean: 1.5 } },
      ideology: {
        evangelicals: { economicLean: 1.0, socialLean: 1.0 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
        gunowners: { economicLean: 1.0, socialLean: 1.0 },
        progressives: { economicLean: -3.5, socialLean: -3.5 },
      },
      education: {
        no_college: { economicLean: -1.0, socialLean: -1.0 },
      },
      wealth: {
        middle: { economicLean: -1.0, socialLean: -1.0 },
      },
      age: {
        senior: { economicLean: -1.0, socialLean: -1.0 },
      },
    },
  },
  MO: {
    race: { white: 87, black: 11, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 82, college: 12, graduate: 6 },
    wealth: { low: 30, middle: 55, high: 15 },
    age: { young: 27, mid: 26, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 24,
      environmentalists: 3,
      libertarians: 6,
      progressives: 6,
      patriots: 13,
      gunowners: 16,
    },
    positions: {
      race: { white: { economicLean: 2, socialLean: 1.5 } },
      ideology: {
        evangelicals: { economicLean: 2.0, socialLean: 2.0 },
        patriots: { economicLean: 1.5, socialLean: 1.5 },
        gunowners: { economicLean: 2.0, socialLean: 2.0 },
        progressives: { economicLean: -2.5, socialLean: -2.5 },
      },
      education: {
        no_college: { economicLean: 0.0, socialLean: 0.0 },
      },
      wealth: {
        middle: { economicLean: 0.0, socialLean: 0.0 },
      },
      age: {
        senior: { economicLean: 0.0, socialLean: 0.0 },
      },
    },
  },
  ND: {
    race: { white: 94, black: 1, hispanic: 1, asian: 1, other: 3 },
    education: { no_college: 82, college: 13, graduate: 5 },
    wealth: { low: 28, middle: 58, high: 14 },
    age: { young: 28, mid: 25, mature: 25, senior: 22 },
    ideology: {
      evangelicals: 20,
      environmentalists: 3,
      libertarians: 8,
      progressives: 4,
      patriots: 14,
      gunowners: 17,
    },
    positions: {
      race: { white: { economicLean: 0.4, socialLean: 1.3 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 2.5 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 1.0, socialLean: 1.0 },
      },
      wealth: {
        middle: { economicLean: 1.0, socialLean: 1.0 },
      },
      age: {
        senior: { economicLean: 1.0, socialLean: 1.0 },
      },
    },
  },
  NE: {
    race: { white: 93, black: 4, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 81, college: 13, graduate: 6 },
    wealth: { low: 26, middle: 59, high: 15 },
    age: { young: 28, mid: 26, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 21,
      environmentalists: 3,
      libertarians: 7,
      progressives: 4,
      patriots: 14,
      gunowners: 16,
    },
    positions: {
      race: { white: { economicLean: 1.1, socialLean: 1.7 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 2.5 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 1.0, socialLean: 1.0 },
      },
      wealth: {
        middle: { economicLean: 1.0, socialLean: 1.0 },
      },
      age: {
        senior: { economicLean: 1.0, socialLean: 1.0 },
      },
    },
  },
  OH: {
    race: { white: 87, black: 11, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 83, college: 11, graduate: 6 },
    wealth: { low: 28, middle: 56, high: 16 },
    age: { young: 27, mid: 26, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 16,
      environmentalists: 5,
      libertarians: 6,
      progressives: 7,
      patriots: 12,
      gunowners: 15,
    },
    positions: {
      race: { white: { economicLean: 3.4, socialLean: 2.3 } },
      ideology: {
        evangelicals: { economicLean: 2.0, socialLean: 2.0 },
        patriots: { economicLean: 1.5, socialLean: 1.5 },
        gunowners: { economicLean: 2.0, socialLean: 2.0 },
        progressives: { economicLean: -2.5, socialLean: -2.5 },
      },
      education: {
        no_college: { economicLean: -0.5, socialLean: -0.5 },
      },
      wealth: {
        middle: { economicLean: -0.5, socialLean: -0.5 },
      },
      age: {
        senior: { economicLean: -0.5, socialLean: -0.5 },
      },
    },
  },
  SD: {
    race: { white: 91, black: 1, hispanic: 1, asian: 0, other: 7 },
    education: { no_college: 83, college: 12, graduate: 5 },
    wealth: { low: 32, middle: 55, high: 13 },
    age: { young: 27, mid: 25, mature: 25, senior: 23 },
    ideology: {
      evangelicals: 21,
      environmentalists: 3,
      libertarians: 8,
      progressives: 4,
      patriots: 14,
      gunowners: 18,
    },
    positions: {
      race: { white: { economicLean: 0.1, socialLean: 1.2 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 2.5 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 1.0, socialLean: 1.0 },
      },
      wealth: {
        middle: { economicLean: 1.0, socialLean: 1.0 },
      },
      age: {
        senior: { economicLean: 1.0, socialLean: 1.0 },
      },
    },
  },
  WI: {
    race: { white: 91, black: 5, hispanic: 2, asian: 1, other: 1 },
    education: { no_college: 82, college: 12, graduate: 6 },
    wealth: { low: 25, middle: 59, high: 16 },
    age: { young: 28, mid: 26, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 13,
      environmentalists: 7,
      libertarians: 6,
      progressives: 9,
      patriots: 10,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 1.8, socialLean: 1.4 } },
      ideology: {
        evangelicals: { economicLean: 1.5, socialLean: 1.5 },
        patriots: { economicLean: 1.0, socialLean: 1.0 },
        gunowners: { economicLean: 1.5, socialLean: 1.5 },
        progressives: { economicLean: -3.0, socialLean: -3.0 },
      },
      education: {
        no_college: { economicLean: -0.5, socialLean: -0.5 },
      },
      wealth: {
        middle: { economicLean: -0.5, socialLean: -0.5 },
      },
      age: {
        senior: { economicLean: -0.5, socialLean: -0.5 },
      },
    },
  },

  // ---- Southwest ----
  AZ: {
    race: { white: 71, black: 3, hispanic: 19, asian: 2, other: 5 },
    education: { no_college: 80, college: 14, graduate: 6 },
    wealth: { low: 28, middle: 55, high: 17 },
    age: { young: 28, mid: 26, mature: 24, senior: 22 },
    ideology: {
      evangelicals: 15,
      environmentalists: 5,
      libertarians: 10,
      progressives: 5,
      patriots: 12,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 2, socialLean: 2.1 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 2.5 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 1.0, socialLean: 1.0 },
      },
      wealth: {
        middle: { economicLean: 1.0, socialLean: 1.0 },
      },
      age: {
        senior: { economicLean: 1.0, socialLean: 1.0 },
      },
    },
  },
  NM: {
    race: { white: 50, black: 2, hispanic: 38, asian: 1, other: 9 },
    education: { no_college: 80, college: 13, graduate: 7 },
    wealth: { low: 36, middle: 50, high: 14 },
    age: { young: 29, mid: 27, mature: 25, senior: 19 },
    ideology: {
      evangelicals: 14,
      environmentalists: 8,
      libertarians: 6,
      progressives: 9,
      patriots: 10,
      gunowners: 11,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 3 } },
      ideology: {
        evangelicals: { economicLean: 1.5, socialLean: 1.5 },
        patriots: { economicLean: 1.0, socialLean: 1.0 },
        gunowners: { economicLean: 1.5, socialLean: 1.5 },
        progressives: { economicLean: -3.0, socialLean: -3.0 },
      },
      education: {
        no_college: { economicLean: -0.5, socialLean: -0.5 },
      },
      wealth: {
        middle: { economicLean: -0.5, socialLean: -0.5 },
      },
      age: {
        senior: { economicLean: -0.5, socialLean: -0.5 },
      },
    },
  },
  OK: {
    race: { white: 81, black: 7, hispanic: 3, asian: 1, other: 8 },
    education: { no_college: 82, college: 12, graduate: 6 },
    wealth: { low: 34, middle: 53, high: 13 },
    age: { young: 28, mid: 26, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 38,
      environmentalists: 2,
      libertarians: 6,
      progressives: 3,
      patriots: 16,
      gunowners: 20,
    },
  },
  TX: {
    race: { white: 60, black: 12, hispanic: 26, asian: 2, other: 0 },
    education: { no_college: 80, college: 14, graduate: 6 },
    wealth: { low: 32, middle: 52, high: 16 },
    age: { young: 31, mid: 28, mature: 24, senior: 17 },
    ideology: {
      evangelicals: 28,
      environmentalists: 3,
      libertarians: 7,
      progressives: 5,
      patriots: 15,
      gunowners: 17,
    },
    positions: {
      race: { white: { economicLean: 2.7, socialLean: 2.5 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 2.5 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 1.0, socialLean: 1.0 },
      },
      wealth: {
        middle: { economicLean: 1.0, socialLean: 1.0 },
      },
      age: {
        senior: { economicLean: 1.0, socialLean: 1.0 },
      },
    },
  },

  // ---- West ----
  AK: {
    race: { white: 74, black: 4, hispanic: 3, asian: 4, other: 15 },
    education: { no_college: 77, college: 16, graduate: 7 },
    wealth: { low: 22, middle: 57, high: 21 },
    age: { young: 32, mid: 31, mature: 25, senior: 12 },
    ideology: {
      evangelicals: 14,
      environmentalists: 6,
      libertarians: 14,
      progressives: 4,
      patriots: 15,
      gunowners: 20,
    },
    positions: {
      race: { white: { economicLean: 1.8, socialLean: 2.2 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 2.5 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 1.0, socialLean: 1.0 },
      },
      wealth: {
        middle: { economicLean: 1.0, socialLean: 1.0 },
      },
      age: {
        senior: { economicLean: 1.0, socialLean: 1.0 },
      },
    },
  },
  CA: {
    race: { white: 57, black: 7, hispanic: 26, asian: 9, other: 1 },
    education: { no_college: 77, college: 15, graduate: 8 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 31, mid: 28, mature: 24, senior: 17 },
    ideology: {
      evangelicals: 12,
      environmentalists: 11,
      libertarians: 6,
      progressives: 11,
      patriots: 8,
      gunowners: 8,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 2.8 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.0, socialLean: 0.0 },
        gunowners: { economicLean: 0.5, socialLean: 0.5 },
        progressives: { economicLean: -4.0, socialLean: -4.0 },
      },
      education: {
        no_college: { economicLean: -0.5, socialLean: -0.5 },
      },
      wealth: {
        middle: { economicLean: -0.5, socialLean: -0.5 },
      },
      age: {
        senior: { economicLean: -0.5, socialLean: -0.5 },
      },
    },
  },
  CO: {
    race: { white: 80, black: 4, hispanic: 13, asian: 2, other: 1 },
    education: { no_college: 73, college: 18, graduate: 9 },
    wealth: { low: 24, middle: 57, high: 19 },
    age: { young: 30, mid: 30, mature: 24, senior: 16 },
    ideology: {
      evangelicals: 14,
      environmentalists: 12,
      libertarians: 9,
      progressives: 8,
      patriots: 11,
      gunowners: 11,
    },
    positions: {
      race: { white: { economicLean: 2.5, socialLean: 2.2 } },
      ideology: {
        evangelicals: { economicLean: 2.0, socialLean: 2.0 },
        patriots: { economicLean: 1.5, socialLean: 1.5 },
        gunowners: { economicLean: 2.0, socialLean: 2.0 },
        progressives: { economicLean: -2.5, socialLean: -2.5 },
      },
      education: {
        no_college: { economicLean: 0.0, socialLean: 0.0 },
      },
      wealth: {
        middle: { economicLean: 0.0, socialLean: 0.0 },
      },
      age: {
        senior: { economicLean: 0.0, socialLean: 0.0 },
      },
    },
  },
  HI: {
    race: { white: 31, black: 2, hispanic: 7, asian: 55, other: 5 },
    education: { no_college: 77, college: 16, graduate: 7 },
    wealth: { low: 22, middle: 57, high: 21 },
    age: { young: 29, mid: 28, mature: 25, senior: 18 },
    ideology: {
      evangelicals: 8,
      environmentalists: 10,
      libertarians: 3,
      progressives: 13,
      patriots: 7,
      gunowners: 4,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 2.8 } },
      ideology: {
        evangelicals: { economicLean: 0.0, socialLean: 0.0 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
        progressives: { economicLean: -4.5, socialLean: -4.5 },
      },
      education: {
        no_college: { economicLean: -1.0, socialLean: -1.0 },
      },
      wealth: {
        middle: { economicLean: -1.0, socialLean: -1.0 },
      },
      age: {
        senior: { economicLean: -1.0, socialLean: -1.0 },
      },
    },
  },
  ID: {
    race: { white: 92, black: 0, hispanic: 5, asian: 1, other: 2 },
    education: { no_college: 82, college: 12, graduate: 6 },
    wealth: { low: 30, middle: 56, high: 14 },
    age: { young: 30, mid: 26, mature: 25, senior: 19 },
    ideology: {
      evangelicals: 22,
      environmentalists: 4,
      libertarians: 12,
      progressives: 3,
      patriots: 15,
      gunowners: 22,
    },
    positions: {
      race: { white: { economicLean: 0.8, socialLean: 1.8 } },
      ideology: {
        evangelicals: { economicLean: 3.5, socialLean: 3.5 },
        patriots: { economicLean: 3.0, socialLean: 3.0 },
        gunowners: { economicLean: 3.0, socialLean: 3.0 },
        progressives: { economicLean: -1.5, socialLean: -1.5 },
      },
      education: {
        no_college: { economicLean: 1.5, socialLean: 1.5 },
      },
      wealth: {
        middle: { economicLean: 1.5, socialLean: 1.5 },
      },
      age: {
        senior: { economicLean: 1.5, socialLean: 1.5 },
      },
    },
  },
  MT: {
    race: { white: 91, black: 0, hispanic: 2, asian: 1, other: 6 },
    education: { no_college: 80, college: 14, graduate: 6 },
    wealth: { low: 32, middle: 55, high: 13 },
    age: { young: 27, mid: 26, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 15,
      environmentalists: 7,
      libertarians: 12,
      progressives: 5,
      patriots: 13,
      gunowners: 22,
    },
    positions: {
      race: { white: { economicLean: 1.9, socialLean: 1.4 } },
      ideology: {
        evangelicals: { economicLean: 2.0, socialLean: 2.0 },
        patriots: { economicLean: 1.5, socialLean: 1.5 },
        gunowners: { economicLean: 2.0, socialLean: 2.0 },
        progressives: { economicLean: -2.5, socialLean: -2.5 },
      },
      education: {
        no_college: { economicLean: 0.0, socialLean: 0.0 },
      },
      wealth: {
        middle: { economicLean: 0.0, socialLean: 0.0 },
      },
      age: {
        senior: { economicLean: 0.0, socialLean: 0.0 },
      },
    },
  },
  NV: {
    race: { white: 79, black: 6, hispanic: 10, asian: 3, other: 2 },
    education: { no_college: 85, college: 10, graduate: 5 },
    wealth: { low: 24, middle: 57, high: 19 },
    age: { young: 29, mid: 29, mature: 26, senior: 16 },
    ideology: {
      evangelicals: 11,
      environmentalists: 5,
      libertarians: 13,
      progressives: 5,
      patriots: 11,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 4.2, socialLean: 2.8 } },
      ideology: {
        evangelicals: { economicLean: 1.5, socialLean: 1.5 },
        patriots: { economicLean: 1.0, socialLean: 1.0 },
        gunowners: { economicLean: 1.5, socialLean: 1.5 },
        progressives: { economicLean: -3.0, socialLean: -3.0 },
      },
      education: {
        no_college: { economicLean: -0.5, socialLean: -0.5 },
      },
      wealth: {
        middle: { economicLean: -0.5, socialLean: -0.5 },
      },
      age: {
        senior: { economicLean: -0.5, socialLean: -0.5 },
      },
    },
  },
  OR: {
    race: { white: 91, black: 2, hispanic: 4, asian: 2, other: 1 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 28, middle: 56, high: 16 },
    age: { young: 27, mid: 27, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 10,
      environmentalists: 14,
      libertarians: 8,
      progressives: 10,
      patriots: 8,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 1.8, socialLean: 1.4 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.0, socialLean: 0.0 },
        gunowners: { economicLean: 0.5, socialLean: 0.5 },
        progressives: { economicLean: -4.0, socialLean: -4.0 },
      },
      education: {
        no_college: { economicLean: -0.5, socialLean: -0.5 },
      },
      wealth: {
        middle: { economicLean: -0.5, socialLean: -0.5 },
      },
      age: {
        senior: { economicLean: -0.5, socialLean: -0.5 },
      },
    },
  },
  UT: {
    race: { white: 91, black: 1, hispanic: 5, asian: 2, other: 1 },
    education: { no_college: 78, college: 15, graduate: 7 },
    wealth: { low: 24, middle: 61, high: 15 },
    age: { young: 37, mid: 27, mature: 22, senior: 14 },
    ideology: {
      evangelicals: 36,
      environmentalists: 3,
      libertarians: 8,
      progressives: 3,
      patriots: 13,
      gunowners: 13,
    },
    positions: {
      race: { white: { economicLean: 3.2, socialLean: 2.8 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 2.5 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 0.5, socialLean: 0.5 },
      },
      wealth: {
        middle: { economicLean: 0.5, socialLean: 0.5 },
      },
      age: {
        senior: { economicLean: 0.5, socialLean: 0.5 },
      },
    },
  },
  WA: {
    race: { white: 87, black: 3, hispanic: 4, asian: 4, other: 2 },
    education: { no_college: 77, college: 15, graduate: 8 },
    wealth: { low: 24, middle: 57, high: 19 },
    age: { young: 29, mid: 28, mature: 25, senior: 18 },
    ideology: {
      evangelicals: 9,
      environmentalists: 14,
      libertarians: 7,
      progressives: 11,
      patriots: 8,
      gunowners: 11,
    },
    positions: {
      race: { white: { economicLean: -1.3, socialLean: 0.1 } },
      ideology: {
        evangelicals: { economicLean: 4.0, socialLean: 4.0 },
        patriots: { economicLean: 3.5, socialLean: 3.5 },
        gunowners: { economicLean: 3.5, socialLean: 3.5 },
        progressives: { economicLean: -1.5, socialLean: -1.5 },
      },
      education: {
        no_college: { economicLean: 1.5, socialLean: 1.5 },
      },
      wealth: {
        middle: { economicLean: 1.5, socialLean: 1.5 },
      },
      age: {
        senior: { economicLean: 1.5, socialLean: 1.5 },
      },
    },
  },
  WY: {
    race: { white: 91, black: 1, hispanic: 6, asian: 1, other: 1 },
    education: { no_college: 81, college: 13, graduate: 6 },
    wealth: { low: 28, middle: 58, high: 14 },
    age: { young: 29, mid: 27, mature: 25, senior: 19 },
    ideology: {
      evangelicals: 17,
      environmentalists: 4,
      libertarians: 14,
      progressives: 3,
      patriots: 16,
      gunowners: 24,
    },
    positions: {
      race: { white: { economicLean: 1, socialLean: 1.9 } },
      ideology: {
        evangelicals: { economicLean: 3.5, socialLean: 3.5 },
        patriots: { economicLean: 3.0, socialLean: 3.0 },
        gunowners: { economicLean: 3.0, socialLean: 3.0 },
        progressives: { economicLean: -1.5, socialLean: -1.5 },
      },
      education: {
        no_college: { economicLean: 1.5, socialLean: 1.5 },
      },
      wealth: {
        middle: { economicLean: 1.5, socialLean: 1.5 },
      },
      age: {
        senior: { economicLean: -0.5, socialLean: -0.5 },
      },
    },
  },
  DC: {
    race: { white: 27, black: 65, hispanic: 5, asian: 2, other: 1 },
    education: { no_college: 67, college: 17, graduate: 16 },
    wealth: { low: 38, middle: 42, high: 20 },
    age: { young: 32, mid: 30, mature: 23, senior: 15 },
    ideology: {
      evangelicals: 9,
      environmentalists: 8,
      libertarians: 2,
      progressives: 17,
      patriots: 5,
      gunowners: 3,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 2.2 } },
      ideology: {
        evangelicals: { economicLean: -1.0, socialLean: -1.0 },
        patriots: { economicLean: -1.5, socialLean: -1.5 },
        gunowners: { economicLean: -1.0, socialLean: -1.0 },
        progressives: { economicLean: -5.0, socialLean: -5.0 },
      },
      education: {
        no_college: { economicLean: -2.0, socialLean: -2.0 },
      },
      wealth: {
        middle: { economicLean: -2.0, socialLean: -2.0 },
      },
      age: {
        senior: { economicLean: -2.0, socialLean: -2.0 },
      },
    },
  },
};
