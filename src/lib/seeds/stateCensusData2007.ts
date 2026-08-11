import type { Layer1Config } from "./stateDemographics";

/**
 * 2007-era US state census profiles (Layer 1 demographics).
 *
 * Era anchor: 2006–2008 American Community Survey estimates, hand-authored
 * independently per state — values are NOT derived from or scaled against the
 * 2019 dataset in `stateCensusData.ts`; that file was consulted only for the
 * field shape and ideology-scale conventions.
 *
 * Key national reference points circa 2007:
 * - Race mix: White ~66%, Black ~12%, Hispanic ~15%, Asian ~4.4%.
 * - Bachelor's degree or higher ~28% (markedly below 2019 levels).
 * - Median age ~36.5; Baby Boomers still mostly working-age, so senior
 *   shares run lower and mid/mature shares higher than 2019.
 * - Pre-crash housing-boom prosperity inflates middle/high wealth shares in
 *   Sun Belt boom states (NV, AZ, FL) and depresses "low" shares there.
 * - Politics: Iraq-War polarization, evangelical political power near its
 *   peak (post-2004 values-voter era), environmentalism rising but not yet
 *   mainstream (An Inconvenient Truth era), libertarian streak visible in
 *   the Mountain West, Hispanic growth accelerating in the Southwest and
 *   Southeast but still below 2019 shares.
 *
 * Ideology values are independent shares of the population (do not sum
 * to 100); race, education, wealth, and age each sum to exactly 100.
 */
export const stateCensusData2007: Record<string, Layer1Config> = {
  AK: {
    race: { white: 67, black: 4, hispanic: 6, asian: 5, other: 18 },
    education: { no_college: 56, college: 30, graduate: 14 },
    wealth: { low: 24, middle: 56, high: 20 },
    age: { young: 27, mid: 29, mature: 27, senior: 17 },
    ideology: {
      evangelicals: 14,
      environmentalists: 12,
      libertarians: 12,
      progressives: 11,
      patriots: 8,
      gunowners: 18,
    },
    positions: {
      race: { white: { economicLean: 4.1, socialLean: 3.3 } },
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
  AL: {
    race: { white: 70, black: 26, hispanic: 2, asian: 1, other: 1 },
    education: { no_college: 62, college: 26, graduate: 12 },
    wealth: { low: 34, middle: 52, high: 14 },
    age: { young: 24, mid: 27, mature: 28, senior: 21 },
    ideology: {
      evangelicals: 28,
      environmentalists: 6,
      libertarians: 4,
      progressives: 10,
      patriots: 8,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 3.5 } },
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
    race: { white: 76, black: 16, hispanic: 5, asian: 1, other: 2 },
    education: { no_college: 66, college: 24, graduate: 10 },
    wealth: { low: 34, middle: 52, high: 14 },
    age: { young: 24, mid: 26, mature: 28, senior: 22 },
    ideology: {
      evangelicals: 27,
      environmentalists: 6,
      libertarians: 5,
      progressives: 9,
      patriots: 8,
      gunowners: 15,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 3.1 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 2.5 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.5, socialLean: -2.5 },
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
  AZ: {
    race: { white: 60, black: 4, hispanic: 29, asian: 2, other: 5 },
    education: { no_college: 60, college: 28, graduate: 12 },
    wealth: { low: 26, middle: 54, high: 20 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 14,
      environmentalists: 10,
      libertarians: 8,
      progressives: 13,
      patriots: 6,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 3.3 } },
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
  CA: {
    race: { white: 43, black: 6, hispanic: 36, asian: 12, other: 3 },
    education: { no_college: 56, college: 28, graduate: 16 },
    wealth: { low: 26, middle: 50, high: 24 },
    age: { young: 27, mid: 28, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 9,
      environmentalists: 16,
      libertarians: 5,
      progressives: 21,
      patriots: 3,
      gunowners: 6,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 2.3 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
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
    race: { white: 72, black: 4, hispanic: 20, asian: 3, other: 1 },
    education: { no_college: 52, college: 32, graduate: 16 },
    wealth: { low: 22, middle: 54, high: 24 },
    age: { young: 26, mid: 29, mature: 27, senior: 18 },
    ideology: {
      evangelicals: 13,
      environmentalists: 15,
      libertarians: 8,
      progressives: 16,
      patriots: 5,
      gunowners: 11,
    },
    positions: {
      race: { white: { economicLean: 3.9, socialLean: 2.1 } },
      ideology: {
        evangelicals: { economicLean: 1.0, socialLean: 1.0 },
        patriots: { economicLean: 1.0, socialLean: 1.0 },
        gunowners: { economicLean: 1.0, socialLean: 1.0 },
        progressives: { economicLean: -3.5, socialLean: -3.5 },
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
  CT: {
    race: { white: 74, black: 9, hispanic: 11, asian: 4, other: 2 },
    education: { no_college: 52, college: 29, graduate: 19 },
    wealth: { low: 22, middle: 52, high: 26 },
    age: { young: 24, mid: 26, mature: 27, senior: 23 },
    ideology: {
      evangelicals: 6,
      environmentalists: 14,
      libertarians: 5,
      progressives: 20,
      patriots: 3,
      gunowners: 5,
    },
    positions: {
      race: { white: { economicLean: 2.4, socialLean: 1.2 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
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
  DC: {
    race: { white: 34, black: 55, hispanic: 8, asian: 3, other: 0 },
    education: { no_college: 44, college: 26, graduate: 30 },
    wealth: { low: 32, middle: 42, high: 26 },
    age: { young: 30, mid: 28, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 8,
      environmentalists: 14,
      libertarians: 3,
      progressives: 30,
      patriots: 2,
      gunowners: 2,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 1.7 } },
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
  DE: {
    race: { white: 68, black: 21, hispanic: 6, asian: 3, other: 2 },
    education: { no_college: 56, college: 28, graduate: 16 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 24, mid: 26, mature: 27, senior: 23 },
    ideology: {
      evangelicals: 9,
      environmentalists: 13,
      libertarians: 5,
      progressives: 18,
      patriots: 4,
      gunowners: 6,
    },
    positions: {
      race: { white: { economicLean: 3.4, socialLean: 1.8 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
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
  FL: {
    race: { white: 61, black: 15, hispanic: 20, asian: 2, other: 2 },
    education: { no_college: 60, college: 28, graduate: 12 },
    wealth: { low: 28, middle: 52, high: 20 },
    age: { young: 23, mid: 26, mature: 26, senior: 25 },
    ideology: {
      evangelicals: 16,
      environmentalists: 10,
      libertarians: 6,
      progressives: 14,
      patriots: 6,
      gunowners: 9,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 2.5 } },
      ideology: {
        evangelicals: { economicLean: 1.0, socialLean: 1.0 },
        patriots: { economicLean: 1.0, socialLean: 1.0 },
        gunowners: { economicLean: 1.0, socialLean: 1.0 },
        progressives: { economicLean: -3.5, socialLean: -3.5 },
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
  GA: {
    race: { white: 59, black: 30, hispanic: 8, asian: 3, other: 0 },
    education: { no_college: 60, college: 27, graduate: 13 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 27, mid: 29, mature: 26, senior: 18 },
    ideology: {
      evangelicals: 24,
      environmentalists: 7,
      libertarians: 5,
      progressives: 13,
      patriots: 7,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 3.1 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 2.5 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.5, socialLean: -2.5 },
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
  HI: {
    race: { white: 25, black: 2, hispanic: 9, asian: 41, other: 23 },
    education: { no_college: 56, college: 30, graduate: 14 },
    wealth: { low: 24, middle: 54, high: 22 },
    age: { young: 25, mid: 27, mature: 27, senior: 21 },
    ideology: {
      evangelicals: 8,
      environmentalists: 16,
      libertarians: 4,
      progressives: 20,
      patriots: 3,
      gunowners: 3,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 2.3 } },
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
  IA: {
    race: { white: 91, black: 2, hispanic: 4, asian: 2, other: 1 },
    education: { no_college: 62, college: 26, graduate: 12 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 24, mid: 25, mature: 27, senior: 24 },
    ideology: {
      evangelicals: 16,
      environmentalists: 10,
      libertarians: 6,
      progressives: 13,
      patriots: 5,
      gunowners: 10,
    },
    positions: {
      race: { white: { economicLean: 3.2, socialLean: 1.5 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
        gunowners: { economicLean: 0.5, socialLean: 0.5 },
        progressives: { economicLean: -4.0, socialLean: -4.0 },
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
    race: { white: 86, black: 1, hispanic: 10, asian: 1, other: 2 },
    education: { no_college: 62, college: 26, graduate: 12 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 27, mid: 27, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 20,
      environmentalists: 9,
      libertarians: 11,
      progressives: 8,
      patriots: 8,
      gunowners: 18,
    },
    positions: {
      race: { white: { economicLean: 2.5, socialLean: 2.5 } },
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
  IL: {
    race: { white: 65, black: 15, hispanic: 15, asian: 4, other: 1 },
    education: { no_college: 56, college: 28, graduate: 16 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 25, mid: 27, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 11,
      environmentalists: 12,
      libertarians: 4,
      progressives: 18,
      patriots: 4,
      gunowners: 6,
    },
    positions: {
      race: { white: { economicLean: 3.4, socialLean: 1.9 } },
      ideology: {
        evangelicals: { economicLean: 1.0, socialLean: 1.0 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
        gunowners: { economicLean: 1.0, socialLean: 1.0 },
        progressives: { economicLean: -3.5, socialLean: -3.5 },
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
    race: { white: 84, black: 9, hispanic: 5, asian: 1, other: 1 },
    education: { no_college: 64, college: 25, graduate: 11 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 25, mid: 26, mature: 27, senior: 22 },
    ideology: {
      evangelicals: 21,
      environmentalists: 7,
      libertarians: 6,
      progressives: 11,
      patriots: 7,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 2.1, socialLean: 1.5 } },
      ideology: {
        evangelicals: { economicLean: 1.5, socialLean: 1.5 },
        patriots: { economicLean: 1.5, socialLean: 1.5 },
        gunowners: { economicLean: 1.5, socialLean: 1.5 },
        progressives: { economicLean: -3.0, socialLean: -3.0 },
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
  KS: {
    race: { white: 81, black: 6, hispanic: 9, asian: 2, other: 2 },
    education: { no_college: 58, college: 28, graduate: 14 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 26, mid: 26, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 19,
      environmentalists: 8,
      libertarians: 8,
      progressives: 10,
      patriots: 7,
      gunowners: 13,
    },
    positions: {
      race: { white: { economicLean: 2.7, socialLean: 2.4 } },
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
  KY: {
    race: { white: 88, black: 7, hispanic: 2, asian: 1, other: 2 },
    education: { no_college: 68, college: 22, graduate: 10 },
    wealth: { low: 34, middle: 52, high: 14 },
    age: { young: 24, mid: 27, mature: 28, senior: 21 },
    ideology: {
      evangelicals: 26,
      environmentalists: 6,
      libertarians: 5,
      progressives: 9,
      patriots: 8,
      gunowners: 15,
    },
    positions: {
      race: { white: { economicLean: 3.2, socialLean: 2.3 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 2.5 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.5, socialLean: -2.5 },
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
  LA: {
    race: { white: 63, black: 32, hispanic: 3, asian: 1, other: 1 },
    education: { no_college: 66, college: 24, graduate: 10 },
    wealth: { low: 34, middle: 50, high: 16 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 24,
      environmentalists: 6,
      libertarians: 4,
      progressives: 11,
      patriots: 8,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 3.1 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 2.5 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.5, socialLean: -2.5 },
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
  MA: {
    race: { white: 80, black: 6, hispanic: 8, asian: 5, other: 1 },
    education: { no_college: 48, college: 30, graduate: 22 },
    wealth: { low: 22, middle: 50, high: 28 },
    age: { young: 25, mid: 27, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 4,
      environmentalists: 16,
      libertarians: 4,
      progressives: 22,
      patriots: 3,
      gunowners: 4,
    },
    positions: {
      race: { white: { economicLean: 2.5, socialLean: 0.9 } },
      ideology: {
        evangelicals: { economicLean: 0.0, socialLean: 0.0 },
        patriots: { economicLean: -1.0, socialLean: -1.0 },
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
    race: { white: 58, black: 29, hispanic: 6, asian: 5, other: 2 },
    education: { no_college: 52, college: 28, graduate: 20 },
    wealth: { low: 22, middle: 52, high: 26 },
    age: { young: 25, mid: 28, mature: 27, senior: 20 },
    ideology: {
      evangelicals: 9,
      environmentalists: 14,
      libertarians: 4,
      progressives: 21,
      patriots: 4,
      gunowners: 5,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 2.3 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
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
    race: { white: 96, black: 1, hispanic: 1, asian: 1, other: 1 },
    education: { no_college: 60, college: 27, graduate: 13 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 21, mid: 24, mature: 29, senior: 26 },
    ideology: {
      evangelicals: 7,
      environmentalists: 15,
      libertarians: 7,
      progressives: 15,
      patriots: 5,
      gunowners: 9,
    },
    positions: {
      race: { white: { economicLean: 1.8, socialLean: 0.9 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
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
  MI: {
    race: { white: 79, black: 14, hispanic: 4, asian: 2, other: 1 },
    education: { no_college: 60, college: 26, graduate: 14 },
    wealth: { low: 28, middle: 52, high: 20 },
    age: { young: 24, mid: 26, mature: 28, senior: 22 },
    ideology: {
      evangelicals: 15,
      environmentalists: 11,
      libertarians: 5,
      progressives: 15,
      patriots: 5,
      gunowners: 10,
    },
    positions: {
      race: { white: { economicLean: 2.9, socialLean: 1.5 } },
      ideology: {
        evangelicals: { economicLean: 1.0, socialLean: 1.0 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
        gunowners: { economicLean: 1.0, socialLean: 1.0 },
        progressives: { economicLean: -3.5, socialLean: -3.5 },
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
    race: { white: 86, black: 4, hispanic: 4, asian: 3, other: 3 },
    education: { no_college: 54, college: 31, graduate: 15 },
    wealth: { low: 22, middle: 56, high: 22 },
    age: { young: 25, mid: 27, mature: 27, senior: 21 },
    ideology: {
      evangelicals: 13,
      environmentalists: 14,
      libertarians: 6,
      progressives: 17,
      patriots: 4,
      gunowners: 10,
    },
    positions: {
      race: { white: { economicLean: 3.2, socialLean: 1.5 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.0, socialLean: 0.0 },
        gunowners: { economicLean: 0.5, socialLean: 0.5 },
        progressives: { economicLean: -4.0, socialLean: -4.0 },
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
    race: { white: 83, black: 11, hispanic: 3, asian: 1, other: 2 },
    education: { no_college: 62, college: 26, graduate: 12 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 24, mid: 26, mature: 27, senior: 23 },
    ideology: {
      evangelicals: 21,
      environmentalists: 8,
      libertarians: 6,
      progressives: 12,
      patriots: 6,
      gunowners: 13,
    },
    positions: {
      race: { white: { economicLean: 3.1, socialLean: 2.1 } },
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
  MS: {
    race: { white: 59, black: 37, hispanic: 2, asian: 1, other: 1 },
    education: { no_college: 68, college: 22, graduate: 10 },
    wealth: { low: 38, middle: 48, high: 14 },
    age: { young: 27, mid: 27, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 30,
      environmentalists: 5,
      libertarians: 3,
      progressives: 9,
      patriots: 8,
      gunowners: 15,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 3.5 } },
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
  MT: {
    race: { white: 89, black: 0, hispanic: 2, asian: 1, other: 8 },
    education: { no_college: 60, college: 27, graduate: 13 },
    wealth: { low: 30, middle: 54, high: 16 },
    age: { young: 23, mid: 25, mature: 29, senior: 23 },
    ideology: {
      evangelicals: 14,
      environmentalists: 13,
      libertarians: 10,
      progressives: 11,
      patriots: 8,
      gunowners: 19,
    },
    positions: {
      race: { white: { economicLean: 2.1, socialLean: 1.9 } },
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
  NC: {
    race: { white: 67, black: 21, hispanic: 7, asian: 2, other: 3 },
    education: { no_college: 62, college: 26, graduate: 12 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 26, mid: 28, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 23,
      environmentalists: 8,
      libertarians: 5,
      progressives: 12,
      patriots: 7,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 2.9 } },
      ideology: {
        evangelicals: { economicLean: 1.5, socialLean: 1.5 },
        patriots: { economicLean: 1.5, socialLean: 1.5 },
        gunowners: { economicLean: 1.5, socialLean: 1.5 },
        progressives: { economicLean: -3.0, socialLean: -3.0 },
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
    race: { white: 91, black: 1, hispanic: 2, asian: 1, other: 5 },
    education: { no_college: 58, college: 29, graduate: 13 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 26, mid: 24, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 15,
      environmentalists: 8,
      libertarians: 7,
      progressives: 10,
      patriots: 6,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 1.7, socialLean: 1.8 } },
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
    race: { white: 86, black: 4, hispanic: 8, asian: 1, other: 1 },
    education: { no_college: 58, college: 29, graduate: 13 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 26, mid: 26, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 17,
      environmentalists: 8,
      libertarians: 7,
      progressives: 10,
      patriots: 6,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 2.5, socialLean: 2.3 } },
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
  NH: {
    race: { white: 94, black: 1, hispanic: 2, asian: 2, other: 1 },
    education: { no_college: 52, college: 31, graduate: 17 },
    wealth: { low: 20, middle: 54, high: 26 },
    age: { young: 23, mid: 26, mature: 29, senior: 22 },
    ideology: {
      evangelicals: 5,
      environmentalists: 13,
      libertarians: 11,
      progressives: 15,
      patriots: 4,
      gunowners: 9,
    },
    positions: {
      race: { white: { economicLean: 2.8, socialLean: 1.1 } },
      ideology: {
        evangelicals: { economicLean: -0.5, socialLean: -0.5 },
        patriots: { economicLean: -1.0, socialLean: -1.0 },
        gunowners: { economicLean: -1.0, socialLean: -1.0 },
        progressives: { economicLean: -5.0, socialLean: -5.0 },
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
  NJ: {
    race: { white: 61, black: 13, hispanic: 16, asian: 8, other: 2 },
    education: { no_college: 52, college: 29, graduate: 19 },
    wealth: { low: 22, middle: 50, high: 28 },
    age: { young: 24, mid: 27, mature: 27, senior: 22 },
    ideology: {
      evangelicals: 6,
      environmentalists: 14,
      libertarians: 4,
      progressives: 20,
      patriots: 4,
      gunowners: 4,
    },
    positions: {
      race: { white: { economicLean: 4.4, socialLean: 2.4 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
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
  NM: {
    race: { white: 42, black: 2, hispanic: 44, asian: 1, other: 11 },
    education: { no_college: 60, college: 25, graduate: 15 },
    wealth: { low: 34, middle: 50, high: 16 },
    age: { young: 26, mid: 26, mature: 27, senior: 21 },
    ideology: {
      evangelicals: 14,
      environmentalists: 12,
      libertarians: 6,
      progressives: 15,
      patriots: 6,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 2.1 } },
      ideology: {
        evangelicals: { economicLean: 0.0, socialLean: 0.0 },
        patriots: { economicLean: 0.0, socialLean: 0.0 },
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
  NV: {
    race: { white: 60, black: 7, hispanic: 25, asian: 6, other: 2 },
    education: { no_college: 64, college: 26, graduate: 10 },
    wealth: { low: 24, middle: 56, high: 20 },
    age: { young: 27, mid: 28, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 11,
      environmentalists: 9,
      libertarians: 9,
      progressives: 13,
      patriots: 5,
      gunowners: 11,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 2.3 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
        gunowners: { economicLean: 0.5, socialLean: 0.5 },
        progressives: { economicLean: -4.0, socialLean: -4.0 },
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
  NY: {
    race: { white: 60, black: 15, hispanic: 16, asian: 7, other: 2 },
    education: { no_college: 54, college: 27, graduate: 19 },
    wealth: { low: 28, middle: 48, high: 24 },
    age: { young: 25, mid: 27, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 6,
      environmentalists: 14,
      libertarians: 4,
      progressives: 21,
      patriots: 3,
      gunowners: 5,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 2.3 } },
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
  OH: {
    race: { white: 83, black: 12, hispanic: 2, asian: 2, other: 1 },
    education: { no_college: 62, college: 26, graduate: 12 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 24, mid: 26, mature: 27, senior: 23 },
    ideology: {
      evangelicals: 17,
      environmentalists: 9,
      libertarians: 5,
      progressives: 13,
      patriots: 6,
      gunowners: 11,
    },
    positions: {
      race: { white: { economicLean: 3.5, socialLean: 1.9 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
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
  OK: {
    race: { white: 74, black: 8, hispanic: 7, asian: 2, other: 9 },
    education: { no_college: 64, college: 25, graduate: 11 },
    wealth: { low: 32, middle: 52, high: 16 },
    age: { young: 26, mid: 26, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 28,
      environmentalists: 5,
      libertarians: 6,
      progressives: 8,
      patriots: 9,
      gunowners: 16,
    },
    positions: {
      race: { white: { economicLean: 4.4, socialLean: 3.5 } },
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
  OR: {
    race: { white: 83, black: 2, hispanic: 10, asian: 4, other: 1 },
    education: { no_college: 56, college: 29, graduate: 15 },
    wealth: { low: 26, middle: 54, high: 20 },
    age: { young: 24, mid: 27, mature: 28, senior: 21 },
    ideology: {
      evangelicals: 12,
      environmentalists: 18,
      libertarians: 8,
      progressives: 18,
      patriots: 4,
      gunowners: 10,
    },
    positions: {
      race: { white: { economicLean: 2.4, socialLean: 1.2 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
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
  PA: {
    race: { white: 82, black: 10, hispanic: 4, asian: 2, other: 2 },
    education: { no_college: 60, college: 26, graduate: 14 },
    wealth: { low: 26, middle: 54, high: 20 },
    age: { young: 23, mid: 25, mature: 27, senior: 25 },
    ideology: {
      evangelicals: 14,
      environmentalists: 10,
      libertarians: 5,
      progressives: 15,
      patriots: 5,
      gunowners: 10,
    },
    positions: {
      race: { white: { economicLean: 2.9, socialLean: 1.7 } },
      ideology: {
        evangelicals: { economicLean: 1.0, socialLean: 1.0 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
        gunowners: { economicLean: 1.0, socialLean: 1.0 },
        progressives: { economicLean: -3.5, socialLean: -3.5 },
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
    race: { white: 79, black: 5, hispanic: 11, asian: 3, other: 2 },
    education: { no_college: 56, college: 27, graduate: 17 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 25, mid: 26, mature: 26, senior: 23 },
    ideology: {
      evangelicals: 5,
      environmentalists: 14,
      libertarians: 4,
      progressives: 20,
      patriots: 3,
      gunowners: 4,
    },
    positions: {
      race: { white: { economicLean: 2.5, socialLean: 1.1 } },
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
  SC: {
    race: { white: 66, black: 29, hispanic: 3, asian: 1, other: 1 },
    education: { no_college: 62, college: 26, graduate: 12 },
    wealth: { low: 32, middle: 52, high: 16 },
    age: { young: 25, mid: 27, mature: 27, senior: 21 },
    ideology: {
      evangelicals: 26,
      environmentalists: 7,
      libertarians: 4,
      progressives: 11,
      patriots: 8,
      gunowners: 13,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 3.5 } },
      ideology: {
        evangelicals: { economicLean: 3.0, socialLean: 3.0 },
        patriots: { economicLean: 2.5, socialLean: 2.5 },
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
  SD: {
    race: { white: 87, black: 1, hispanic: 2, asian: 1, other: 9 },
    education: { no_college: 60, college: 27, graduate: 13 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 25, mid: 24, mature: 27, senior: 24 },
    ideology: {
      evangelicals: 18,
      environmentalists: 8,
      libertarians: 7,
      progressives: 9,
      patriots: 7,
      gunowners: 15,
    },
    positions: {
      race: { white: { economicLean: 1.8, socialLean: 1.9 } },
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
  TN: {
    race: { white: 78, black: 17, hispanic: 3, asian: 1, other: 1 },
    education: { no_college: 64, college: 24, graduate: 12 },
    wealth: { low: 32, middle: 52, high: 16 },
    age: { young: 24, mid: 27, mature: 27, senior: 22 },
    ideology: {
      evangelicals: 27,
      environmentalists: 6,
      libertarians: 5,
      progressives: 10,
      patriots: 8,
      gunowners: 13,
    },
    positions: {
      race: { white: { economicLean: 4.1, socialLean: 3 } },
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
  TX: {
    race: { white: 48, black: 11, hispanic: 36, asian: 3, other: 2 },
    education: { no_college: 62, college: 26, graduate: 12 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 29, mid: 28, mature: 25, senior: 18 },
    ideology: {
      evangelicals: 21,
      environmentalists: 7,
      libertarians: 6,
      progressives: 12,
      patriots: 7,
      gunowners: 13,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 3.3 } },
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
  UT: {
    race: { white: 84, black: 1, hispanic: 11, asian: 2, other: 2 },
    education: { no_college: 56, college: 30, graduate: 14 },
    wealth: { low: 22, middle: 58, high: 20 },
    age: { young: 35, mid: 28, mature: 23, senior: 14 },
    ideology: {
      evangelicals: 10,
      environmentalists: 8,
      libertarians: 12,
      progressives: 8,
      patriots: 7,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 3.2, socialLean: 2.9 } },
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
  VA: {
    race: { white: 67, black: 19, hispanic: 7, asian: 5, other: 2 },
    education: { no_college: 56, college: 28, graduate: 16 },
    wealth: { low: 24, middle: 52, high: 24 },
    age: { young: 26, mid: 28, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 18,
      environmentalists: 10,
      libertarians: 5,
      progressives: 15,
      patriots: 6,
      gunowners: 10,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 2.5 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
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
  VT: {
    race: { white: 96, black: 1, hispanic: 1, asian: 1, other: 1 },
    education: { no_college: 56, college: 28, graduate: 16 },
    wealth: { low: 26, middle: 54, high: 20 },
    age: { young: 22, mid: 24, mature: 30, senior: 24 },
    ideology: {
      evangelicals: 5,
      environmentalists: 22,
      libertarians: 7,
      progressives: 23,
      patriots: 3,
      gunowners: 8,
    },
    positions: {
      race: { white: { economicLean: 1.2, socialLean: 0.1 } },
      ideology: {
        evangelicals: { economicLean: 0.0, socialLean: 0.0 },
        patriots: { economicLean: -1.0, socialLean: -1.0 },
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
  WA: {
    race: { white: 78, black: 3, hispanic: 9, asian: 7, other: 3 },
    education: { no_college: 54, college: 30, graduate: 16 },
    wealth: { low: 24, middle: 54, high: 22 },
    age: { young: 25, mid: 28, mature: 27, senior: 20 },
    ideology: {
      evangelicals: 11,
      environmentalists: 17,
      libertarians: 7,
      progressives: 18,
      patriots: 4,
      gunowners: 9,
    },
    positions: {
      race: { white: { economicLean: 2.5, socialLean: 1.3 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
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
  WI: {
    race: { white: 86, black: 6, hispanic: 5, asian: 2, other: 1 },
    education: { no_college: 58, college: 28, graduate: 14 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 24, mid: 26, mature: 27, senior: 23 },
    ideology: {
      evangelicals: 14,
      environmentalists: 11,
      libertarians: 5,
      progressives: 15,
      patriots: 5,
      gunowners: 11,
    },
    positions: {
      race: { white: { economicLean: 2.5, socialLean: 1.3 } },
      ideology: {
        evangelicals: { economicLean: 1.0, socialLean: 1.0 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
        gunowners: { economicLean: 1.0, socialLean: 1.0 },
        progressives: { economicLean: -3.5, socialLean: -3.5 },
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
  WV: {
    race: { white: 94, black: 3, hispanic: 1, asian: 1, other: 1 },
    education: { no_college: 72, college: 19, graduate: 9 },
    wealth: { low: 38, middle: 50, high: 12 },
    age: { young: 22, mid: 25, mature: 29, senior: 24 },
    ideology: {
      evangelicals: 24,
      environmentalists: 6,
      libertarians: 4,
      progressives: 9,
      patriots: 9,
      gunowners: 16,
    },
    positions: {
      // Post-2000 realignment: WV votes solidly Republican (Bush twice);
      // working class econ-center, strongly social-right.
      race: { white: { economicLean: 3.4, socialLean: 3.2 } },
      ideology: {
        evangelicals: { economicLean: 3.0, socialLean: 4.0 },
        patriots: { economicLean: 2.5, socialLean: 3.0 },
        gunowners: { economicLean: 3.0, socialLean: 3.0 },
        progressives: { economicLean: -4.0, socialLean: -4.0 },
      },
      education: {
        no_college: { economicLean: 0.0, socialLean: 1.5 },
      },
      wealth: {
        middle: { economicLean: 0.0, socialLean: 0.5 },
      },
      age: {
        senior: { economicLean: 0.0, socialLean: 1.5 },
      },
    },
  },
  WY: {
    race: { white: 90, black: 1, hispanic: 7, asian: 1, other: 1 },
    education: { no_college: 60, college: 27, graduate: 13 },
    wealth: { low: 24, middle: 58, high: 18 },
    age: { young: 25, mid: 26, mature: 27, senior: 22 },
    ideology: {
      evangelicals: 16,
      environmentalists: 10,
      libertarians: 12,
      progressives: 8,
      patriots: 9,
      gunowners: 20,
    },
    positions: {
      race: { white: { economicLean: 2.5, socialLean: 2.5 } },
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
};
