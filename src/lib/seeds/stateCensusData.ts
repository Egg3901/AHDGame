import type { Layer1Config } from "./stateDemographics";

export const stateCensusData: Record<string, Layer1Config> = {
  CT: {
    race: { white: 66, black: 12, hispanic: 17, asian: 5, other: 0 },
    education: { no_college: 52, college: 30, graduate: 18 },
    wealth: { low: 22, middle: 52, high: 26 },
    age: { young: 22, mid: 25, mature: 27, senior: 26 },
    ideology: {
      evangelicals: 6,
      environmentalists: 16,
      libertarians: 5,
      progressives: 23,
      patriots: 3,
      gunowners: 5,
    },
    positions: {
      race: { white: { economicLean: -0.6, socialLean: -0.6 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
        progressives: { economicLean: -4.5, socialLean: -4.5 },
      },
      education: {
        no_college: { economicLean: -0.1, socialLean: -0.1 },
      },
      wealth: {
        middle: { economicLean: -0.1, socialLean: -0.1 },
      },
      age: {
        senior: { economicLean: -0.1, socialLean: -0.1 },
      },
    },
  },
  DE: {
    race: { white: 62, black: 23, hispanic: 10, asian: 4, other: 1 },
    education: { no_college: 56, college: 30, graduate: 14 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 23, mid: 25, mature: 26, senior: 26 },
    ideology: {
      evangelicals: 6,
      environmentalists: 17,
      libertarians: 5,
      progressives: 23,
      patriots: 4,
      gunowners: 5,
    },
    positions: {
      race: { white: { economicLean: -0.4, socialLean: -0.4 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
        progressives: { economicLean: -4.5, socialLean: -4.5 },
      },
      education: {
        no_college: { economicLean: 0.1, socialLean: 0.1 },
      },
      wealth: {
        middle: { economicLean: 0.1, socialLean: 0.1 },
      },
      age: {
        senior: { economicLean: 0.1, socialLean: 0.1 },
      },
    },
  },
  MA: {
    race: { white: 71, black: 9, hispanic: 12, asian: 7, other: 1 },
    education: { no_college: 48, college: 30, graduate: 22 },
    wealth: { low: 22, middle: 50, high: 28 },
    age: { young: 24, mid: 26, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 5,
      environmentalists: 18,
      libertarians: 4,
      progressives: 23,
      patriots: 4,
      gunowners: 5,
    },
    positions: {
      race: { white: { economicLean: -1.8, socialLean: -1.8 } },
      ideology: {
        evangelicals: { economicLean: 0.0, socialLean: 0.0 },
        patriots: { economicLean: -1.0, socialLean: -1.0 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
        progressives: { economicLean: -5.0, socialLean: -5.0 },
      },
      education: {
        no_college: { economicLean: -0.8, socialLean: -0.8 },
      },
      wealth: {
        middle: { economicLean: -0.8, socialLean: -0.8 },
      },
      age: {
        senior: { economicLean: -0.8, socialLean: -0.8 },
      },
    },
  },
  MD: {
    race: { white: 50, black: 31, hispanic: 11, asian: 7, other: 1 },
    education: { no_college: 50, college: 30, graduate: 20 },
    wealth: { low: 22, middle: 52, high: 26 },
    age: { young: 24, mid: 27, mature: 27, senior: 22 },
    ideology: {
      evangelicals: 8,
      environmentalists: 16,
      libertarians: 4,
      progressives: 24,
      patriots: 4,
      gunowners: 5,
    },
    positions: {
      race: { white: { economicLean: -1.5, socialLean: -1.5 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
        progressives: { economicLean: -4.5, socialLean: -4.5 },
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
    race: { white: 93, black: 2, hispanic: 2, asian: 1, other: 2 },
    education: { no_college: 58, college: 28, graduate: 14 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 20, mid: 23, mature: 28, senior: 29 },
    ideology: {
      evangelicals: 7,
      environmentalists: 17,
      libertarians: 7,
      progressives: 18,
      patriots: 5,
      gunowners: 8,
    },
    positions: {
      race: { white: { economicLean: -0.2, socialLean: -0.2 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
        progressives: { economicLean: -4.5, socialLean: -4.5 },
      },
      education: {
        no_college: { economicLean: 0.3, socialLean: 0.3 },
      },
      wealth: {
        middle: { economicLean: 0.3, socialLean: 0.3 },
      },
      age: {
        senior: { economicLean: 0.3, socialLean: 0.3 },
      },
    },
  },
  NH: {
    race: { white: 90, black: 2, hispanic: 4, asian: 3, other: 1 },
    education: { no_college: 52, college: 32, graduate: 16 },
    wealth: { low: 20, middle: 54, high: 26 },
    age: { young: 21, mid: 25, mature: 28, senior: 26 },
    ideology: {
      evangelicals: 6,
      environmentalists: 15,
      libertarians: 9,
      progressives: 17,
      patriots: 5,
      gunowners: 9,
    },
    positions: {
      race: { white: { economicLean: -0.5, socialLean: -0.5 } },
      ideology: {
        evangelicals: { economicLean: -0.5, socialLean: -0.5 },
        patriots: { economicLean: -1.0, socialLean: -1.0 },
        gunowners: { economicLean: -1.0, socialLean: -1.0 },
        progressives: { economicLean: -5.5, socialLean: -5.5 },
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
  NJ: {
    race: { white: 54, black: 15, hispanic: 21, asian: 10, other: 0 },
    education: { no_college: 50, college: 30, graduate: 20 },
    wealth: { low: 22, middle: 50, high: 28 },
    age: { young: 23, mid: 26, mature: 27, senior: 24 },
    ideology: {
      evangelicals: 6,
      environmentalists: 16,
      libertarians: 5,
      progressives: 23,
      patriots: 4,
      gunowners: 5,
    },
    positions: {
      race: { white: { economicLean: -0.1, socialLean: -0.1 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
        progressives: { economicLean: -4.5, socialLean: -4.5 },
      },
      education: {
        no_college: { economicLean: 0.4, socialLean: 0.4 },
      },
      wealth: {
        middle: { economicLean: 0.4, socialLean: 0.4 },
      },
      age: {
        senior: { economicLean: 0.4, socialLean: 0.4 },
      },
    },
  },
  NY: {
    race: { white: 54, black: 18, hispanic: 19, asian: 9, other: 0 },
    education: { no_college: 52, college: 28, graduate: 20 },
    wealth: { low: 28, middle: 48, high: 24 },
    age: { young: 24, mid: 27, mature: 26, senior: 23 },
    ideology: {
      evangelicals: 7,
      environmentalists: 16,
      libertarians: 4,
      progressives: 22,
      patriots: 4,
      gunowners: 6,
    },
    positions: {
      race: { white: { economicLean: -0.4, socialLean: -0.4 } },
      ideology: {
        evangelicals: { economicLean: 0.0, socialLean: 0.0 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
        progressives: { economicLean: -5.0, socialLean: -5.0 },
      },
      education: {
        no_college: { economicLean: 0.1, socialLean: 0.1 },
      },
      wealth: {
        middle: { economicLean: 0.1, socialLean: 0.1 },
      },
      age: {
        senior: { economicLean: 0.1, socialLean: 0.1 },
      },
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
    positions: {
      race: { white: { economicLean: 1.1, socialLean: 1.1 } },
      ideology: {
        evangelicals: { economicLean: 1.0, socialLean: 1.0 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
        gunowners: { economicLean: 1.0, socialLean: 1.0 },
        progressives: { economicLean: -3.5, socialLean: -3.5 },
      },
      education: {
        no_college: { economicLean: 0.6, socialLean: 0.6 },
      },
      wealth: {
        middle: { economicLean: 0.6, socialLean: 0.6 },
      },
      age: {
        senior: { economicLean: 0.6, socialLean: 0.6 },
      },
    },
  },
  RI: {
    race: { white: 71, black: 8, hispanic: 16, asian: 4, other: 1 },
    education: { no_college: 54, college: 30, graduate: 16 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 24, mid: 26, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 5,
      environmentalists: 17,
      libertarians: 5,
      progressives: 22,
      patriots: 3,
      gunowners: 5,
    },
    positions: {
      race: { white: { economicLean: -0.6, socialLean: -0.6 } },
      ideology: {
        evangelicals: { economicLean: 0.0, socialLean: 0.0 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
        progressives: { economicLean: -5.0, socialLean: -5.0 },
      },
      education: {
        no_college: { economicLean: -0.1, socialLean: -0.1 },
      },
      wealth: {
        middle: { economicLean: -0.1, socialLean: -0.1 },
      },
      age: {
        senior: { economicLean: -0.1, socialLean: -0.1 },
      },
    },
  },
  VT: {
    race: { white: 93, black: 1, hispanic: 2, asian: 2, other: 2 },
    education: { no_college: 52, college: 30, graduate: 18 },
    wealth: { low: 26, middle: 54, high: 20 },
    age: { young: 22, mid: 24, mature: 28, senior: 26 },
    ideology: {
      evangelicals: 5,
      environmentalists: 21,
      libertarians: 6,
      progressives: 23,
      patriots: 4,
      gunowners: 7,
    },
    positions: {
      race: { white: { economicLean: -2.0, socialLean: -2.0 } },
      ideology: {
        evangelicals: { economicLean: 0.0, socialLean: 0.0 },
        patriots: { economicLean: -1.0, socialLean: -1.0 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
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
    positions: {
      race: { white: { economicLean: 3.9, socialLean: 3.9 } },
      ideology: {
        evangelicals: { economicLean: 4.0, socialLean: 4.0 },
        patriots: { economicLean: 3.5, socialLean: 3.5 },
        gunowners: { economicLean: 3.0, socialLean: 3.0 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 2.4, socialLean: 2.4 },
      },
      wealth: {
        middle: { economicLean: 2.4, socialLean: 2.4 },
      },
      age: {
        senior: { economicLean: 2.4, socialLean: 2.4 },
      },
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
    positions: {
      race: { white: { economicLean: 3.3, socialLean: 3.3 } },
      ideology: {
        evangelicals: { economicLean: 3.0, socialLean: 3.0 },
        patriots: { economicLean: 2.5, socialLean: 2.5 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.5, socialLean: -2.5 },
      },
      education: {
        no_college: { economicLean: 2.3, socialLean: 2.3 },
      },
      wealth: {
        middle: { economicLean: 2.3, socialLean: 2.3 },
      },
      age: {
        senior: { economicLean: 2.3, socialLean: 2.3 },
      },
    },
  },
  FL: {
    race: { white: 53, black: 17, hispanic: 26, asian: 3, other: 1 },
    education: { no_college: 58, college: 28, graduate: 14 },
    wealth: { low: 28, middle: 50, high: 22 },
    age: { young: 22, mid: 24, mature: 26, senior: 28 },
    ideology: {
      evangelicals: 17,
      environmentalists: 11,
      libertarians: 7,
      progressives: 11,
      patriots: 11,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 1.2, socialLean: 1.2 } },
      ideology: {
        evangelicals: { economicLean: 1.0, socialLean: 1.0 },
        patriots: { economicLean: 1.0, socialLean: 1.0 },
        gunowners: { economicLean: 1.0, socialLean: 1.0 },
        progressives: { economicLean: -4.0, socialLean: -4.0 },
      },
      education: {
        no_college: { economicLean: 1.7, socialLean: 1.7 },
      },
      wealth: {
        middle: { economicLean: 1.7, socialLean: 1.7 },
      },
      age: {
        senior: { economicLean: 1.7, socialLean: 1.7 },
      },
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
    positions: {
      race: { white: { economicLean: 2.3, socialLean: 2.3 } },
      ideology: {
        evangelicals: { economicLean: 3.0, socialLean: 3.0 },
        patriots: { economicLean: 2.5, socialLean: 2.5 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.5, socialLean: -2.5 },
      },
      education: {
        no_college: { economicLean: 1.3, socialLean: 1.3 },
      },
      wealth: {
        middle: { economicLean: 1.3, socialLean: 1.3 },
      },
      age: {
        senior: { economicLean: 1.3, socialLean: 1.3 },
      },
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
    positions: {
      race: { white: { economicLean: 2.8, socialLean: 2.8 } },
      ideology: {
        evangelicals: { economicLean: 3.0, socialLean: 3.0 },
        patriots: { economicLean: 2.5, socialLean: 2.5 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.5, socialLean: -2.5 },
      },
      education: {
        no_college: { economicLean: 1.8, socialLean: 1.8 },
      },
      wealth: {
        middle: { economicLean: 1.8, socialLean: 1.8 },
      },
      age: {
        senior: { economicLean: 1.8, socialLean: 1.8 },
      },
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
    positions: {
      race: { white: { economicLean: 3.4, socialLean: 3.4 } },
      ideology: {
        evangelicals: { economicLean: 3.0, socialLean: 3.0 },
        patriots: { economicLean: 2.5, socialLean: 2.5 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.5, socialLean: -2.5 },
      },
      education: {
        no_college: { economicLean: 2.4, socialLean: 2.4 },
      },
      wealth: {
        middle: { economicLean: 2.4, socialLean: 2.4 },
      },
      age: {
        senior: { economicLean: 2.4, socialLean: 2.4 },
      },
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
    positions: {
      race: { white: { economicLean: 3.8, socialLean: 3.8 } },
      ideology: {
        evangelicals: { economicLean: 4.0, socialLean: 4.0 },
        patriots: { economicLean: 3.5, socialLean: 3.5 },
        gunowners: { economicLean: 3.0, socialLean: 3.0 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 2.3, socialLean: 2.3 },
      },
      wealth: {
        middle: { economicLean: 2.3, socialLean: 2.3 },
      },
      age: {
        senior: { economicLean: 2.3, socialLean: 2.3 },
      },
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
      progressives: 12,
      patriots: 10,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 2.0, socialLean: 2.0 } },
      ideology: {
        evangelicals: { economicLean: 2.0, socialLean: 2.0 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
        gunowners: { economicLean: 1.5, socialLean: 1.5 },
        progressives: { economicLean: -3.0, socialLean: -3.0 },
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
    positions: {
      race: { white: { economicLean: 3.0, socialLean: 3.0 } },
      ideology: {
        evangelicals: { economicLean: 3.5, socialLean: 3.5 },
        patriots: { economicLean: 3.0, socialLean: 3.0 },
        gunowners: { economicLean: 3.0, socialLean: 3.0 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
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
    positions: {
      race: { white: { economicLean: 3.3, socialLean: 3.3 } },
      ideology: {
        evangelicals: { economicLean: 3.0, socialLean: 3.0 },
        patriots: { economicLean: 2.5, socialLean: 2.5 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 1.8, socialLean: 1.8 },
      },
      wealth: {
        middle: { economicLean: 1.8, socialLean: 1.8 },
      },
      age: {
        senior: { economicLean: 1.8, socialLean: 1.8 },
      },
    },
  },
  VA: {
    race: { white: 61, black: 20, hispanic: 10, asian: 7, other: 2 },
    education: { no_college: 50, college: 30, graduate: 20 },
    wealth: { low: 22, middle: 52, high: 26 },
    age: { young: 24, mid: 27, mature: 27, senior: 22 },
    ideology: {
      evangelicals: 10,
      environmentalists: 19,
      libertarians: 6,
      progressives: 26,
      patriots: 6,
      gunowners: 9,
    },
    positions: {
      race: { white: { economicLean: 0.2, socialLean: 0.2 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
        gunowners: { economicLean: 0.5, socialLean: 0.5 },
        progressives: { economicLean: -4.5, socialLean: -4.5 },
      },
      education: {
        no_college: { economicLean: 0.7, socialLean: 0.7 },
      },
      wealth: {
        middle: { economicLean: 0.7, socialLean: 0.7 },
      },
      age: {
        senior: { economicLean: 0.7, socialLean: 0.7 },
      },
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
    positions: {
      // Trump-era WV: among the reddest states; econ populist-right,
      // strongly social-right.
      race: { white: { economicLean: 3.0, socialLean: 3.8 } },
      ideology: {
        evangelicals: { economicLean: 3.5, socialLean: 4.5 },
        patriots: { economicLean: 3.0, socialLean: 3.5 },
        gunowners: { economicLean: 3.0, socialLean: 3.5 },
        progressives: { economicLean: -4.5, socialLean: -4.5 },
      },
      education: {
        no_college: { economicLean: 2.8, socialLean: 4.3 },
      },
      wealth: {
        middle: { economicLean: 2.1, socialLean: 2.6 },
      },
      age: {
        senior: { economicLean: 2.8, socialLean: 3.8 },
      },
    },
  },
  IA: {
    race: { white: 85, black: 4, hispanic: 6, asian: 3, other: 2 },
    education: { no_college: 58, college: 30, graduate: 12 },
    wealth: { low: 24, middle: 56, high: 20 },
    age: { young: 24, mid: 24, mature: 26, senior: 26 },
    ideology: {
      evangelicals: 16,
      environmentalists: 9,
      libertarians: 7,
      progressives: 8,
      patriots: 11,
      gunowners: 15,
    },
    positions: {
      race: { white: { economicLean: 0.8, socialLean: 0.8 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
        gunowners: { economicLean: 0.5, socialLean: 0.5 },
        progressives: { economicLean: -4.5, socialLean: -4.5 },
      },
      education: {
        no_college: { economicLean: 1.3, socialLean: 1.3 },
      },
      wealth: {
        middle: { economicLean: 1.3, socialLean: 1.3 },
      },
      age: {
        senior: { economicLean: 1.3, socialLean: 1.3 },
      },
    },
  },
  IL: {
    race: { white: 61, black: 15, hispanic: 18, asian: 6, other: 0 },
    education: { no_college: 54, college: 30, graduate: 16 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 24, mid: 26, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 7,
      environmentalists: 16,
      libertarians: 5,
      progressives: 23,
      patriots: 4,
      gunowners: 5,
    },
    positions: {
      race: { white: { economicLean: -0.2, socialLean: -0.2 } },
      ideology: {
        evangelicals: { economicLean: 1.0, socialLean: 1.0 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
        gunowners: { economicLean: 1.0, socialLean: 1.0 },
        progressives: { economicLean: -4.0, socialLean: -4.0 },
      },
      education: {
        no_college: { economicLean: 0.3, socialLean: 0.3 },
      },
      wealth: {
        middle: { economicLean: 0.3, socialLean: 0.3 },
      },
      age: {
        senior: { economicLean: 0.3, socialLean: 0.3 },
      },
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
    positions: {
      race: { white: { economicLean: 2.0, socialLean: 2.0 } },
      ideology: {
        evangelicals: { economicLean: 2.0, socialLean: 2.0 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
        gunowners: { economicLean: 1.5, socialLean: 1.5 },
        progressives: { economicLean: -3.0, socialLean: -3.0 },
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
    positions: {
      race: { white: { economicLean: 2.6, socialLean: 2.6 } },
      ideology: {
        evangelicals: { economicLean: 3.0, socialLean: 3.0 },
        patriots: { economicLean: 2.5, socialLean: 2.5 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 1.1, socialLean: 1.1 },
      },
      wealth: {
        middle: { economicLean: 1.1, socialLean: 1.1 },
      },
      age: {
        senior: { economicLean: 1.1, socialLean: 1.1 },
      },
    },
  },
  MI: {
    race: { white: 74, black: 14, hispanic: 5, asian: 3, other: 4 },
    education: { no_college: 58, college: 28, graduate: 14 },
    wealth: { low: 28, middle: 52, high: 20 },
    age: { young: 23, mid: 25, mature: 27, senior: 25 },
    ideology: {
      evangelicals: 12,
      environmentalists: 10,
      libertarians: 6,
      progressives: 13,
      patriots: 7,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 0.4, socialLean: 0.4 } },
      ideology: {
        evangelicals: { economicLean: 1.0, socialLean: 1.0 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
        gunowners: { economicLean: 1.0, socialLean: 1.0 },
        progressives: { economicLean: -4.0, socialLean: -4.0 },
      },
      education: {
        no_college: { economicLean: 0.9, socialLean: 0.9 },
      },
      wealth: {
        middle: { economicLean: 0.9, socialLean: 0.9 },
      },
      age: {
        senior: { economicLean: 0.9, socialLean: 0.9 },
      },
    },
  },
  MN: {
    race: { white: 79, black: 7, hispanic: 6, asian: 5, other: 3 },
    education: { no_college: 52, college: 32, graduate: 16 },
    wealth: { low: 22, middle: 56, high: 22 },
    age: { young: 24, mid: 27, mature: 26, senior: 23 },
    ideology: {
      evangelicals: 9,
      environmentalists: 15,
      libertarians: 6,
      progressives: 17,
      patriots: 5,
      gunowners: 10,
    },
    positions: {
      race: { white: { economicLean: 0.0, socialLean: 0.0 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.0, socialLean: 0.0 },
        gunowners: { economicLean: 0.5, socialLean: 0.5 },
        progressives: { economicLean: -4.5, socialLean: -4.5 },
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
    positions: {
      race: { white: { economicLean: 2.3, socialLean: 2.3 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 2.5 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
        gunowners: { economicLean: 2.0, socialLean: 2.0 },
        progressives: { economicLean: -2.5, socialLean: -2.5 },
      },
      education: {
        no_college: { economicLean: 1.3, socialLean: 1.3 },
      },
      wealth: {
        middle: { economicLean: 1.3, socialLean: 1.3 },
      },
      age: {
        senior: { economicLean: 1.3, socialLean: 1.3 },
      },
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
    positions: {
      race: { white: { economicLean: 3.4, socialLean: 3.4 } },
      ideology: {
        evangelicals: { economicLean: 3.0, socialLean: 3.0 },
        patriots: { economicLean: 2.5, socialLean: 2.5 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 1.9, socialLean: 1.9 },
      },
      wealth: {
        middle: { economicLean: 1.9, socialLean: 1.9 },
      },
      age: {
        senior: { economicLean: 1.9, socialLean: 1.9 },
      },
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
    positions: {
      race: { white: { economicLean: 2.8, socialLean: 2.8 } },
      ideology: {
        evangelicals: { economicLean: 3.0, socialLean: 3.0 },
        patriots: { economicLean: 2.5, socialLean: 2.5 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 1.3, socialLean: 1.3 },
      },
      wealth: {
        middle: { economicLean: 1.3, socialLean: 1.3 },
      },
      age: {
        senior: { economicLean: 1.3, socialLean: 1.3 },
      },
    },
  },
  OH: {
    race: { white: 78, black: 13, hispanic: 4, asian: 2, other: 3 },
    education: { no_college: 60, college: 28, graduate: 12 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 23, mid: 25, mature: 27, senior: 25 },
    ideology: {
      evangelicals: 16,
      environmentalists: 8,
      libertarians: 7,
      progressives: 9,
      patriots: 11,
      gunowners: 15,
    },
    positions: {
      race: { white: { economicLean: 0.9, socialLean: 0.9 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
        gunowners: { economicLean: 0.5, socialLean: 0.5 },
        progressives: { economicLean: -4.5, socialLean: -4.5 },
      },
      education: {
        no_college: { economicLean: 1.4, socialLean: 1.4 },
      },
      wealth: {
        middle: { economicLean: 1.4, socialLean: 1.4 },
      },
      age: {
        senior: { economicLean: 1.4, socialLean: 1.4 },
      },
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
    positions: {
      race: { white: { economicLean: 3.1, socialLean: 3.1 } },
      ideology: {
        evangelicals: { economicLean: 3.0, socialLean: 3.0 },
        patriots: { economicLean: 2.5, socialLean: 2.5 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 1.6, socialLean: 1.6 },
      },
      wealth: {
        middle: { economicLean: 1.6, socialLean: 1.6 },
      },
      age: {
        senior: { economicLean: 1.6, socialLean: 1.6 },
      },
    },
  },
  WI: {
    race: { white: 81, black: 7, hispanic: 7, asian: 3, other: 2 },
    education: { no_college: 56, college: 30, graduate: 14 },
    wealth: { low: 24, middle: 56, high: 20 },
    age: { young: 23, mid: 25, mature: 27, senior: 25 },
    ideology: {
      evangelicals: 12,
      environmentalists: 11,
      libertarians: 7,
      progressives: 13,
      patriots: 7,
      gunowners: 11,
    },
    positions: {
      race: { white: { economicLean: 0.4, socialLean: 0.4 } },
      ideology: {
        evangelicals: { economicLean: 1.0, socialLean: 1.0 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
        gunowners: { economicLean: 1.0, socialLean: 1.0 },
        progressives: { economicLean: -4.0, socialLean: -4.0 },
      },
      education: {
        no_college: { economicLean: 0.9, socialLean: 0.9 },
      },
      wealth: {
        middle: { economicLean: 0.9, socialLean: 0.9 },
      },
      age: {
        senior: { economicLean: 0.9, socialLean: 0.9 },
      },
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
    positions: {
      race: { white: { economicLean: 2.3, socialLean: 2.3 } },
      ideology: {
        evangelicals: { economicLean: 3.0, socialLean: 3.0 },
        patriots: { economicLean: 2.5, socialLean: 2.5 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 0.8, socialLean: 0.8 },
      },
      wealth: {
        middle: { economicLean: 0.8, socialLean: 0.8 },
      },
      age: {
        senior: { economicLean: 0.8, socialLean: 0.8 },
      },
    },
  },
  NM: {
    race: { white: 37, black: 2, hispanic: 49, asian: 2, other: 10 },
    education: { no_college: 58, college: 28, graduate: 14 },
    wealth: { low: 32, middle: 50, high: 18 },
    age: { young: 24, mid: 25, mature: 27, senior: 24 },
    ideology: {
      evangelicals: 10,
      environmentalists: 18,
      libertarians: 6,
      progressives: 22,
      patriots: 5,
      gunowners: 6,
    },
    positions: {
      race: { white: { economicLean: 0.2, socialLean: 0.2 } },
      ideology: {
        evangelicals: { economicLean: 0.0, socialLean: 0.0 },
        patriots: { economicLean: 0.0, socialLean: 0.0 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
        progressives: { economicLean: -5.0, socialLean: -5.0 },
      },
      education: {
        no_college: { economicLean: 1.2, socialLean: 1.2 },
      },
      wealth: {
        middle: { economicLean: 1.2, socialLean: 1.2 },
      },
      age: {
        senior: { economicLean: 1.2, socialLean: 1.2 },
      },
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
    positions: {
      race: { white: { economicLean: 4.0, socialLean: 4.0 } },
      ideology: {
        evangelicals: { economicLean: 3.0, socialLean: 3.0 },
        patriots: { economicLean: 2.5, socialLean: 2.5 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 2.5, socialLean: 2.5 },
      },
      wealth: {
        middle: { economicLean: 2.5, socialLean: 2.5 },
      },
      age: {
        senior: { economicLean: 2.5, socialLean: 2.5 },
      },
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
    positions: {
      race: { white: { economicLean: 3.2, socialLean: 3.2 } },
      ideology: {
        evangelicals: { economicLean: 3.0, socialLean: 3.0 },
        patriots: { economicLean: 2.5, socialLean: 2.5 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 1.7, socialLean: 1.7 },
      },
      wealth: {
        middle: { economicLean: 1.7, socialLean: 1.7 },
      },
      age: {
        senior: { economicLean: 1.7, socialLean: 1.7 },
      },
    },
  },
  AK: {
    race: { white: 60, black: 4, hispanic: 7, asian: 6, other: 23 },
    education: { no_college: 56, college: 30, graduate: 14 },
    wealth: { low: 22, middle: 56, high: 22 },
    age: { young: 26, mid: 28, mature: 28, senior: 18 },
    ideology: {
      evangelicals: 14,
      environmentalists: 7,
      libertarians: 12,
      progressives: 6,
      patriots: 13,
      gunowners: 17,
    },
    positions: {
      race: { white: { economicLean: 2.6, socialLean: 2.6 } },
      ideology: {
        evangelicals: { economicLean: 3.0, socialLean: 3.0 },
        patriots: { economicLean: 2.5, socialLean: 2.5 },
        gunowners: { economicLean: 2.5, socialLean: 2.5 },
        progressives: { economicLean: -2.0, socialLean: -2.0 },
      },
      education: {
        no_college: { economicLean: 1.1, socialLean: 1.1 },
      },
      wealth: {
        middle: { economicLean: 1.1, socialLean: 1.1 },
      },
      age: {
        senior: { economicLean: 1.1, socialLean: 1.1 },
      },
    },
  },
  CA: {
    race: { white: 37, black: 6, hispanic: 39, asian: 15, other: 3 },
    education: { no_college: 52, college: 32, graduate: 16 },
    wealth: { low: 28, middle: 50, high: 22 },
    age: { young: 26, mid: 27, mature: 25, senior: 22 },
    ideology: {
      evangelicals: 8,
      environmentalists: 19,
      libertarians: 5,
      progressives: 22,
      patriots: 4,
      gunowners: 6,
    },
    positions: {
      race: { white: { economicLean: -1.2, socialLean: -1.2 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
        progressives: { economicLean: -4.5, socialLean: -4.5 },
      },
      education: {
        no_college: { economicLean: -0.2, socialLean: -0.2 },
      },
      wealth: {
        middle: { economicLean: -0.2, socialLean: -0.2 },
      },
      age: {
        senior: { economicLean: -0.2, socialLean: -0.2 },
      },
    },
  },
  CO: {
    race: { white: 68, black: 4, hispanic: 22, asian: 4, other: 2 },
    education: { no_college: 50, college: 32, graduate: 18 },
    wealth: { low: 22, middle: 54, high: 24 },
    age: { young: 26, mid: 28, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 9,
      environmentalists: 21,
      libertarians: 9,
      progressives: 20,
      patriots: 8,
      gunowners: 7,
    },
    positions: {
      race: { white: { economicLean: -0.1, socialLean: -0.1 } },
      ideology: {
        evangelicals: { economicLean: 1.0, socialLean: 1.0 },
        patriots: { economicLean: 1.0, socialLean: 1.0 },
        gunowners: { economicLean: 1.0, socialLean: 1.0 },
        progressives: { economicLean: -4.0, socialLean: -4.0 },
      },
      education: {
        no_college: { economicLean: 0.4, socialLean: 0.4 },
      },
      wealth: {
        middle: { economicLean: 0.4, socialLean: 0.4 },
      },
      age: {
        senior: { economicLean: 0.4, socialLean: 0.4 },
      },
    },
  },
  HI: {
    race: { white: 22, black: 2, hispanic: 11, asian: 37, other: 28 },
    education: { no_college: 54, college: 30, graduate: 16 },
    wealth: { low: 22, middle: 54, high: 24 },
    age: { young: 24, mid: 26, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 7,
      environmentalists: 18,
      libertarians: 4,
      progressives: 20,
      patriots: 4,
      gunowners: 5,
    },
    positions: {
      race: { white: { economicLean: -1.0, socialLean: -1.0 } },
      ideology: {
        evangelicals: { economicLean: 0.0, socialLean: 0.0 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
        progressives: { economicLean: -5.0, socialLean: -5.0 },
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
    positions: {
      race: { white: { economicLean: 3.4, socialLean: 3.4 } },
      ideology: {
        evangelicals: { economicLean: 4.0, socialLean: 4.0 },
        patriots: { economicLean: 3.5, socialLean: 3.5 },
        gunowners: { economicLean: 3.0, socialLean: 3.0 },
        progressives: { economicLean: -1.5, socialLean: -1.5 },
      },
      education: {
        no_college: { economicLean: 1.9, socialLean: 1.9 },
      },
      wealth: {
        middle: { economicLean: 1.9, socialLean: 1.9 },
      },
      age: {
        senior: { economicLean: 1.9, socialLean: 1.9 },
      },
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
    positions: {
      race: { white: { economicLean: 2.5, socialLean: 2.5 } },
      ideology: {
        evangelicals: { economicLean: 3.0, socialLean: 3.0 },
        patriots: { economicLean: 2.5, socialLean: 2.5 },
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
    positions: {
      race: { white: { economicLean: 0.8, socialLean: 0.8 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
        gunowners: { economicLean: 0.5, socialLean: 0.5 },
        progressives: { economicLean: -4.5, socialLean: -4.5 },
      },
      education: {
        no_college: { economicLean: 1.3, socialLean: 1.3 },
      },
      wealth: {
        middle: { economicLean: 1.3, socialLean: 1.3 },
      },
      age: {
        senior: { economicLean: 1.3, socialLean: 1.3 },
      },
    },
  },
  OR: {
    race: { white: 75, black: 2, hispanic: 13, asian: 5, other: 5 },
    education: { no_college: 54, college: 30, graduate: 16 },
    wealth: { low: 26, middle: 54, high: 20 },
    age: { young: 24, mid: 26, mature: 27, senior: 23 },
    ideology: {
      evangelicals: 6,
      environmentalists: 20,
      libertarians: 8,
      progressives: 22,
      patriots: 4,
      gunowners: 6,
    },
    positions: {
      race: { white: { economicLean: -0.4, socialLean: -0.4 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
        progressives: { economicLean: -4.5, socialLean: -4.5 },
      },
      education: {
        no_college: { economicLean: 0.1, socialLean: 0.1 },
      },
      wealth: {
        middle: { economicLean: 0.1, socialLean: 0.1 },
      },
      age: {
        senior: { economicLean: 0.1, socialLean: 0.1 },
      },
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
    positions: {
      race: { white: { economicLean: 3.0, socialLean: 3.0 } },
      ideology: {
        evangelicals: { economicLean: 4.0, socialLean: 4.0 },
        patriots: { economicLean: 3.5, socialLean: 3.5 },
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
  WA: {
    race: { white: 68, black: 4, hispanic: 13, asian: 10, other: 5 },
    education: { no_college: 50, college: 32, graduate: 18 },
    wealth: { low: 22, middle: 54, high: 24 },
    age: { young: 24, mid: 28, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 7,
      environmentalists: 20,
      libertarians: 7,
      progressives: 22,
      patriots: 4,
      gunowners: 7,
    },
    positions: {
      race: { white: { economicLean: -0.7, socialLean: -0.7 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
        gunowners: { economicLean: 0.0, socialLean: 0.0 },
        progressives: { economicLean: -4.5, socialLean: -4.5 },
      },
      education: {
        no_college: { economicLean: -0.2, socialLean: -0.2 },
      },
      wealth: {
        middle: { economicLean: -0.2, socialLean: -0.2 },
      },
      age: {
        senior: { economicLean: -0.2, socialLean: -0.2 },
      },
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
    positions: {
      race: { white: { economicLean: 4.0, socialLean: 4.0 } },
      ideology: {
        evangelicals: { economicLean: 4.0, socialLean: 4.0 },
        patriots: { economicLean: 3.5, socialLean: 3.5 },
        gunowners: { economicLean: 3.0, socialLean: 3.0 },
        progressives: { economicLean: -1.5, socialLean: -1.5 },
      },
      education: {
        no_college: { economicLean: 2.5, socialLean: 2.5 },
      },
      wealth: {
        middle: { economicLean: 2.5, socialLean: 2.5 },
      },
      age: {
        senior: { economicLean: 2.5, socialLean: 2.5 },
      },
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
    positions: {
      race: { white: { economicLean: -5.0, socialLean: -5.0 } },
      ideology: {
        evangelicals: { economicLean: -1.0, socialLean: -1.0 },
        patriots: { economicLean: -1.5, socialLean: -1.5 },
        gunowners: { economicLean: -1.0, socialLean: -1.0 },
        progressives: { economicLean: -5.5, socialLean: -5.5 },
      },
      education: {
        no_college: { economicLean: -4.2, socialLean: -4.2 },
      },
      wealth: {
        middle: { economicLean: -4.2, socialLean: -4.2 },
      },
      age: {
        senior: { economicLean: -4.2, socialLean: -4.2 },
      },
    },
  },
};
