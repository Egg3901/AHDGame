import type { Layer1Config } from "./stateDemographics";

/**
 * 1999-era US state demographic profiles, anchored to the 2000 Census.
 *
 * Methodology: every state was authored INDEPENDENTLY from historical
 * knowledge of that state circa 1999-2000 — values are NOT scaled or
 * derived from the 2019 dataset in `stateCensusData.ts` (that file was
 * consulted only for field shape and ideology-scale conventions).
 *
 * Key national reference points (Census 2000):
 * - Race: non-Hispanic White ~69%, Black ~12%, Hispanic ~12.5%, Asian ~3.6%
 * - Education: bachelor's degree or higher ~24% of adults 25+
 * - Median age ~35.3 (younger than 2019; smaller senior cohorts)
 * - Dot-com boom prosperity concentrated in CA/WA/MA/CO/CT/NJ tech and
 *   finance corridors; Appalachia and the Deep South lag
 * - Hispanic population growth concentrated in CA/TX/AZ/NM/NV/FL
 * - Evangelical influence strong across the South; environmental movement
 *   mid-strength (strongest in the Pacific Northwest and Vermont);
 *   pre-9/11, so nationalist "patriot" sentiment is modest; partisan
 *   sorting only beginning, so progressive shares run lower than 2019
 *
 * race/education/wealth/age each sum to exactly 100 per state;
 * ideology values are independent shares and do not sum to 100.
 */
export const stateCensusData1999: Record<string, Layer1Config> = {
  AK: {
    race: { white: 69, black: 3, hispanic: 4, asian: 4, other: 20 },
    education: { no_college: 70, college: 20, graduate: 10 },
    wealth: { low: 22, middle: 56, high: 22 },
    age: { young: 30, mid: 29, mature: 26, senior: 15 },
    ideology: {
      evangelicals: 12,
      environmentalists: 8,
      libertarians: 12,
      progressives: 7,
      patriots: 12,
      gunowners: 20,
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
  AL: {
    race: { white: 71, black: 26, hispanic: 2, asian: 1, other: 0 },
    education: { no_college: 76, college: 16, graduate: 8 },
    wealth: { low: 36, middle: 49, high: 15 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 38,
      environmentalists: 2,
      libertarians: 4,
      progressives: 4,
      patriots: 14,
      gunowners: 22,
    },
    positions: {
      race: { white: { economicLean: 2.5, socialLean: 2.3 } },
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
    race: { white: 79, black: 16, hispanic: 3, asian: 1, other: 1 },
    education: { no_college: 78, college: 15, graduate: 7 },
    wealth: { low: 38, middle: 48, high: 14 },
    age: { young: 26, mid: 26, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 35,
      environmentalists: 3,
      libertarians: 5,
      progressives: 4,
      patriots: 13,
      gunowners: 22,
    },
    positions: {
      race: { white: { economicLean: 1.8, socialLean: 1.5 } },
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
    race: { white: 64, black: 3, hispanic: 25, asian: 2, other: 6 },
    education: { no_college: 71, college: 20, graduate: 9 },
    wealth: { low: 28, middle: 52, high: 20 },
    age: { young: 27, mid: 27, mature: 24, senior: 22 },
    ideology: {
      evangelicals: 16,
      environmentalists: 7,
      libertarians: 9,
      progressives: 8,
      patriots: 10,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 2.2, socialLean: 1.9 } },
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
    race: { white: 47, black: 6, hispanic: 32, asian: 11, other: 4 },
    education: { no_college: 67, college: 22, graduate: 11 },
    wealth: { low: 26, middle: 50, high: 24 },
    age: { young: 29, mid: 28, mature: 24, senior: 19 },
    ideology: {
      evangelicals: 9,
      environmentalists: 16,
      libertarians: 5,
      progressives: 18,
      patriots: 4,
      gunowners: 7,
    },
    positions: {
      race: { white: { economicLean: 4.1, socialLean: 2 } },
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
    race: { white: 75, black: 4, hispanic: 17, asian: 2, other: 2 },
    education: { no_college: 62, college: 25, graduate: 13 },
    wealth: { low: 22, middle: 52, high: 26 },
    age: { young: 28, mid: 29, mature: 25, senior: 18 },
    ideology: {
      evangelicals: 14,
      environmentalists: 12,
      libertarians: 9,
      progressives: 12,
      patriots: 7,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 2.3, socialLean: 1.6 } },
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
  CT: {
    race: { white: 77, black: 9, hispanic: 9, asian: 2, other: 3 },
    education: { no_college: 63, college: 23, graduate: 14 },
    wealth: { low: 20, middle: 50, high: 30 },
    age: { young: 25, mid: 27, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 6,
      environmentalists: 13,
      libertarians: 5,
      progressives: 17,
      patriots: 3,
      gunowners: 5,
    },
    positions: {
      race: { white: { economicLean: 0.8, socialLean: 0.3 } },
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
    race: { white: 28, black: 60, hispanic: 8, asian: 3, other: 1 },
    education: { no_college: 55, college: 24, graduate: 21 },
    wealth: { low: 36, middle: 40, high: 24 },
    age: { young: 30, mid: 29, mature: 24, senior: 17 },
    ideology: {
      evangelicals: 8,
      environmentalists: 12,
      libertarians: 3,
      progressives: 24,
      patriots: 3,
      gunowners: 3,
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
    race: { white: 72, black: 19, hispanic: 5, asian: 2, other: 2 },
    education: { no_college: 69, college: 20, graduate: 11 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 8,
      environmentalists: 12,
      libertarians: 5,
      progressives: 16,
      patriots: 5,
      gunowners: 6,
    },
    positions: {
      race: { white: { economicLean: 2, socialLean: 1 } },
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
    race: { white: 65, black: 14, hispanic: 17, asian: 2, other: 2 },
    education: { no_college: 72, college: 19, graduate: 9 },
    wealth: { low: 30, middle: 50, high: 20 },
    age: { young: 24, mid: 26, mature: 25, senior: 25 },
    ideology: {
      evangelicals: 15,
      environmentalists: 7,
      libertarians: 6,
      progressives: 9,
      patriots: 9,
      gunowners: 11,
    },
    positions: {
      race: { white: { economicLean: 2.7, socialLean: 1.8 } },
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
  GA: {
    race: { white: 63, black: 29, hispanic: 5, asian: 2, other: 1 },
    education: { no_college: 70, college: 20, graduate: 10 },
    wealth: { low: 30, middle: 50, high: 20 },
    age: { young: 28, mid: 29, mature: 25, senior: 18 },
    ideology: {
      evangelicals: 30,
      environmentalists: 3,
      libertarians: 5,
      progressives: 7,
      patriots: 13,
      gunowners: 17,
    },
    positions: {
      race: { white: { economicLean: 3.7, socialLean: 2.6 } },
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
    race: { white: 24, black: 2, hispanic: 7, asian: 41, other: 26 },
    education: { no_college: 70, college: 20, graduate: 10 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 26, mid: 28, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 7,
      environmentalists: 14,
      libertarians: 4,
      progressives: 18,
      patriots: 4,
      gunowners: 4,
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
    race: { white: 93, black: 2, hispanic: 3, asian: 1, other: 1 },
    education: { no_college: 73, college: 19, graduate: 8 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 25, mid: 25, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 16,
      environmentalists: 7,
      libertarians: 6,
      progressives: 9,
      patriots: 7,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 1.8, socialLean: 1.1 } },
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
  ID: {
    race: { white: 88, black: 0, hispanic: 8, asian: 1, other: 3 },
    education: { no_college: 72, college: 19, graduate: 9 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 29, mid: 27, mature: 25, senior: 19 },
    ideology: {
      evangelicals: 22,
      environmentalists: 6,
      libertarians: 11,
      progressives: 5,
      patriots: 13,
      gunowners: 20,
    },
    positions: {
      race: { white: { economicLean: 1.9, socialLean: 2.1 } },
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
    race: { white: 68, black: 15, hispanic: 12, asian: 3, other: 2 },
    education: { no_college: 68, college: 21, graduate: 11 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 27, mid: 27, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 12,
      environmentalists: 10,
      libertarians: 5,
      progressives: 15,
      patriots: 6,
      gunowners: 7,
    },
    positions: {
      race: { white: { economicLean: 2.4, socialLean: 1.2 } },
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
    race: { white: 86, black: 8, hispanic: 4, asian: 1, other: 1 },
    education: { no_college: 76, college: 16, graduate: 8 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 22,
      environmentalists: 4,
      libertarians: 6,
      progressives: 7,
      patriots: 10,
      gunowners: 15,
    },
    positions: {
      race: { white: { economicLean: 0.9, socialLean: 1.1 } },
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
    race: { white: 83, black: 6, hispanic: 7, asian: 2, other: 2 },
    education: { no_college: 67, college: 22, graduate: 11 },
    wealth: { low: 26, middle: 55, high: 19 },
    age: { young: 27, mid: 26, mature: 25, senior: 22 },
    ideology: {
      evangelicals: 20,
      environmentalists: 5,
      libertarians: 8,
      progressives: 7,
      patriots: 10,
      gunowners: 15,
    },
    positions: {
      race: { white: { economicLean: 1.3, socialLean: 1.6 } },
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
    race: { white: 89, black: 7, hispanic: 2, asian: 1, other: 1 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 36, middle: 48, high: 16 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 30,
      environmentalists: 3,
      libertarians: 5,
      progressives: 5,
      patriots: 13,
      gunowners: 20,
    },
    positions: {
      race: { white: { economicLean: 1.8, socialLean: 1.5 } },
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
    race: { white: 63, black: 32, hispanic: 2, asian: 1, other: 2 },
    education: { no_college: 77, college: 16, graduate: 7 },
    wealth: { low: 38, middle: 47, high: 15 },
    age: { young: 28, mid: 27, mature: 25, senior: 20 },
    ideology: {
      evangelicals: 26,
      environmentalists: 3,
      libertarians: 4,
      progressives: 8,
      patriots: 12,
      gunowners: 18,
    },
    positions: {
      race: { white: { economicLean: 3.5, socialLean: 2.5 } },
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
    race: { white: 82, black: 5, hispanic: 7, asian: 4, other: 2 },
    education: { no_college: 60, college: 24, graduate: 16 },
    wealth: { low: 22, middle: 48, high: 30 },
    age: { young: 26, mid: 28, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 5,
      environmentalists: 15,
      libertarians: 4,
      progressives: 19,
      patriots: 3,
      gunowners: 4,
    },
    positions: {
      race: { white: { economicLean: 0.6, socialLean: -0.3 } },
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
    race: { white: 62, black: 28, hispanic: 4, asian: 4, other: 2 },
    education: { no_college: 63, college: 22, graduate: 15 },
    wealth: { low: 22, middle: 50, high: 28 },
    age: { young: 26, mid: 29, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 10,
      environmentalists: 12,
      libertarians: 4,
      progressives: 18,
      patriots: 5,
      gunowners: 6,
    },
    positions: {
      race: { white: { economicLean: 2.5, socialLean: 1.1 } },
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
    race: { white: 97, black: 1, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 71, college: 20, graduate: 9 },
    wealth: { low: 30, middle: 54, high: 16 },
    age: { young: 23, mid: 26, mature: 28, senior: 23 },
    ideology: {
      evangelicals: 8,
      environmentalists: 14,
      libertarians: 7,
      progressives: 12,
      patriots: 5,
      gunowners: 10,
    },
    positions: {
      race: { white: { economicLean: 1.5, socialLean: 0.7 } },
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
    race: { white: 79, black: 14, hispanic: 3, asian: 2, other: 2 },
    education: { no_college: 73, college: 18, graduate: 9 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 14,
      environmentalists: 8,
      libertarians: 5,
      progressives: 13,
      patriots: 8,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 2.4, socialLean: 1.2 } },
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
    race: { white: 88, black: 3, hispanic: 3, asian: 3, other: 3 },
    education: { no_college: 67, college: 23, graduate: 10 },
    wealth: { low: 22, middle: 56, high: 22 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 12,
      environmentalists: 11,
      libertarians: 6,
      progressives: 15,
      patriots: 5,
      gunowners: 10,
    },
    positions: {
      race: { white: { economicLean: 2.3, socialLean: 1 } },
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
    race: { white: 84, black: 11, hispanic: 2, asian: 1, other: 2 },
    education: { no_college: 73, college: 18, graduate: 9 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 25, mid: 26, mature: 26, senior: 23 },
    ideology: {
      evangelicals: 22,
      environmentalists: 4,
      libertarians: 7,
      progressives: 8,
      patriots: 10,
      gunowners: 15,
    },
    positions: {
      race: { white: { economicLean: 1.8, socialLean: 1.3 } },
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
    race: { white: 61, black: 36, hispanic: 1, asian: 1, other: 1 },
    education: { no_college: 79, college: 14, graduate: 7 },
    wealth: { low: 42, middle: 45, high: 13 },
    age: { young: 28, mid: 26, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 32,
      environmentalists: 2,
      libertarians: 4,
      progressives: 6,
      patriots: 12,
      gunowners: 17,
    },
    positions: {
      race: { white: { economicLean: 4.2, socialLean: 3.3 } },
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
    race: { white: 90, black: 0, hispanic: 2, asian: 1, other: 7 },
    education: { no_college: 71, college: 20, graduate: 9 },
    wealth: { low: 32, middle: 52, high: 16 },
    age: { young: 25, mid: 25, mature: 27, senior: 23 },
    ideology: {
      evangelicals: 14,
      environmentalists: 10,
      libertarians: 12,
      progressives: 7,
      patriots: 12,
      gunowners: 22,
    },
    positions: {
      race: { white: { economicLean: 2.3, socialLean: 2 } },
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
    race: { white: 70, black: 21, hispanic: 5, asian: 1, other: 3 },
    education: { no_college: 71, college: 19, graduate: 10 },
    wealth: { low: 30, middle: 51, high: 19 },
    age: { young: 26, mid: 28, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 28,
      environmentalists: 4,
      libertarians: 5,
      progressives: 8,
      patriots: 11,
      gunowners: 15,
    },
    positions: {
      race: { white: { economicLean: 2.8, socialLean: 2.3 } },
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
  ND: {
    race: { white: 92, black: 1, hispanic: 1, asian: 1, other: 5 },
    education: { no_college: 71, college: 21, graduate: 8 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 26, mid: 24, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 16,
      environmentalists: 5,
      libertarians: 7,
      progressives: 6,
      patriots: 9,
      gunowners: 16,
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
    race: { white: 87, black: 4, hispanic: 6, asian: 1, other: 2 },
    education: { no_college: 70, college: 21, graduate: 9 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 26, mid: 25, mature: 26, senior: 23 },
    ideology: {
      evangelicals: 18,
      environmentalists: 5,
      libertarians: 7,
      progressives: 7,
      patriots: 9,
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
  NH: {
    race: { white: 95, black: 1, hispanic: 2, asian: 1, other: 1 },
    education: { no_college: 64, college: 23, graduate: 13 },
    wealth: { low: 20, middle: 54, high: 26 },
    age: { young: 25, mid: 28, mature: 27, senior: 20 },
    ideology: {
      evangelicals: 6,
      environmentalists: 12,
      libertarians: 11,
      progressives: 12,
      patriots: 5,
      gunowners: 11,
    },
    positions: {
      race: { white: { economicLean: 1.5, socialLean: 0.7 } },
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
  NJ: {
    race: { white: 66, black: 13, hispanic: 13, asian: 6, other: 2 },
    education: { no_college: 64, college: 22, graduate: 14 },
    wealth: { low: 22, middle: 48, high: 30 },
    age: { young: 26, mid: 28, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 6,
      environmentalists: 12,
      libertarians: 5,
      progressives: 17,
      patriots: 4,
      gunowners: 4,
    },
    positions: {
      race: { white: { economicLean: 1.5, socialLean: 0.7 } },
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
    race: { white: 45, black: 2, hispanic: 42, asian: 1, other: 10 },
    education: { no_college: 71, college: 18, graduate: 11 },
    wealth: { low: 38, middle: 46, high: 16 },
    age: { young: 28, mid: 26, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 14,
      environmentalists: 9,
      libertarians: 7,
      progressives: 11,
      patriots: 8,
      gunowners: 15,
    },
    positions: {
      race: { white: { economicLean: 4.5, socialLean: 2.5 } },
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
  NV: {
    race: { white: 65, black: 7, hispanic: 20, asian: 5, other: 3 },
    education: { no_college: 76, college: 17, graduate: 7 },
    wealth: { low: 26, middle: 54, high: 20 },
    age: { young: 28, mid: 28, mature: 25, senior: 19 },
    ideology: {
      evangelicals: 11,
      environmentalists: 7,
      libertarians: 10,
      progressives: 8,
      patriots: 8,
      gunowners: 13,
    },
    positions: {
      race: { white: { economicLean: 3.7, socialLean: 2.2 } },
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
  NY: {
    race: { white: 62, black: 15, hispanic: 15, asian: 6, other: 2 },
    education: { no_college: 65, college: 21, graduate: 14 },
    wealth: { low: 28, middle: 46, high: 26 },
    age: { young: 27, mid: 28, mature: 25, senior: 20 },
    ideology: {
      evangelicals: 7,
      environmentalists: 13,
      libertarians: 4,
      progressives: 19,
      patriots: 4,
      gunowners: 5,
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
  OH: {
    race: { white: 84, black: 11, hispanic: 2, asian: 1, other: 2 },
    education: { no_college: 75, college: 17, graduate: 8 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 25, mid: 26, mature: 27, senior: 22 },
    ideology: {
      evangelicals: 16,
      environmentalists: 6,
      libertarians: 5,
      progressives: 11,
      patriots: 8,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 1.8, socialLean: 1.3 } },
      ideology: {
        evangelicals: { economicLean: 1.5, socialLean: 1.5 },
        patriots: { economicLean: 1.0, socialLean: 1.0 },
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
  OK: {
    race: { white: 74, black: 7, hispanic: 5, asian: 1, other: 13 },
    education: { no_college: 76, college: 17, graduate: 7 },
    wealth: { low: 34, middle: 50, high: 16 },
    age: { young: 26, mid: 26, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 32,
      environmentalists: 3,
      libertarians: 6,
      progressives: 5,
      patriots: 13,
      gunowners: 20,
    },
    positions: {
      race: { white: { economicLean: 2.1, socialLean: 2.1 } },
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
    race: { white: 84, black: 2, hispanic: 8, asian: 3, other: 3 },
    education: { no_college: 67, college: 22, graduate: 11 },
    wealth: { low: 28, middle: 52, high: 20 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 12,
      environmentalists: 16,
      libertarians: 8,
      progressives: 15,
      patriots: 6,
      gunowners: 11,
    },
    positions: {
      race: { white: { economicLean: 2, socialLean: 1 } },
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
    race: { white: 84, black: 10, hispanic: 3, asian: 2, other: 1 },
    education: { no_college: 74, college: 17, graduate: 9 },
    wealth: { low: 26, middle: 54, high: 20 },
    age: { young: 24, mid: 25, mature: 26, senior: 25 },
    ideology: {
      evangelicals: 13,
      environmentalists: 8,
      libertarians: 4,
      progressives: 12,
      patriots: 7,
      gunowners: 11,
    },
    positions: {
      race: { white: { economicLean: 1.9, socialLean: 1.1 } },
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
    race: { white: 82, black: 4, hispanic: 9, asian: 2, other: 3 },
    education: { no_college: 70, college: 19, graduate: 11 },
    wealth: { low: 28, middle: 50, high: 22 },
    age: { young: 26, mid: 26, mature: 25, senior: 23 },
    ideology: {
      evangelicals: 6,
      environmentalists: 13,
      libertarians: 4,
      progressives: 17,
      patriots: 4,
      gunowners: 4,
    },
    positions: {
      race: { white: { economicLean: 0.9, socialLean: 0.1 } },
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
    race: { white: 66, black: 30, hispanic: 2, asian: 1, other: 1 },
    education: { no_college: 76, college: 16, graduate: 8 },
    wealth: { low: 34, middle: 50, high: 16 },
    age: { young: 27, mid: 27, mature: 26, senior: 20 },
    ideology: {
      evangelicals: 30,
      environmentalists: 3,
      libertarians: 4,
      progressives: 6,
      patriots: 13,
      gunowners: 17,
    },
    positions: {
      race: { white: { economicLean: 2.9, socialLean: 2.5 } },
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
    race: { white: 88, black: 1, hispanic: 1, asian: 1, other: 9 },
    education: { no_college: 74, college: 18, graduate: 8 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 26, mid: 24, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 18,
      environmentalists: 5,
      libertarians: 8,
      progressives: 5,
      patriots: 10,
      gunowners: 17,
    },
    positions: {
      race: { white: { economicLean: 1.3, socialLean: 1.6 } },
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
    race: { white: 79, black: 16, hispanic: 2, asian: 1, other: 2 },
    education: { no_college: 76, college: 16, graduate: 8 },
    wealth: { low: 32, middle: 51, high: 17 },
    age: { young: 26, mid: 27, mature: 26, senior: 21 },
    ideology: {
      evangelicals: 32,
      environmentalists: 3,
      libertarians: 5,
      progressives: 6,
      patriots: 13,
      gunowners: 18,
    },
    positions: {
      race: { white: { economicLean: 1.4, socialLean: 1.4 } },
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
    race: { white: 52, black: 11, hispanic: 32, asian: 3, other: 2 },
    education: { no_college: 74, college: 17, graduate: 9 },
    wealth: { low: 30, middle: 50, high: 20 },
    age: { young: 30, mid: 28, mature: 24, senior: 18 },
    ideology: {
      evangelicals: 24,
      environmentalists: 4,
      libertarians: 8,
      progressives: 8,
      patriots: 11,
      gunowners: 15,
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
    race: { white: 85, black: 1, hispanic: 9, asian: 2, other: 3 },
    education: { no_college: 68, college: 22, graduate: 10 },
    wealth: { low: 22, middle: 58, high: 20 },
    age: { young: 35, mid: 27, mature: 22, senior: 16 },
    ideology: {
      evangelicals: 32,
      environmentalists: 4,
      libertarians: 8,
      progressives: 4,
      patriots: 11,
      gunowners: 11,
    },
    positions: {
      race: { white: { economicLean: 2, socialLean: 2.2 } },
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
    race: { white: 70, black: 19, hispanic: 5, asian: 4, other: 2 },
    education: { no_college: 67, college: 21, graduate: 12 },
    wealth: { low: 24, middle: 52, high: 24 },
    age: { young: 27, mid: 29, mature: 25, senior: 19 },
    ideology: {
      evangelicals: 22,
      environmentalists: 6,
      libertarians: 5,
      progressives: 10,
      patriots: 10,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 3, socialLean: 2 } },
      ideology: {
        evangelicals: { economicLean: 1.5, socialLean: 1.5 },
        patriots: { economicLean: 1.0, socialLean: 1.0 },
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
  VT: {
    race: { white: 96, black: 1, hispanic: 1, asian: 1, other: 1 },
    education: { no_college: 67, college: 21, graduate: 12 },
    wealth: { low: 28, middle: 54, high: 18 },
    age: { young: 25, mid: 26, mature: 28, senior: 21 },
    ideology: {
      evangelicals: 6,
      environmentalists: 18,
      libertarians: 7,
      progressives: 17,
      patriots: 4,
      gunowners: 9,
    },
    positions: {
      race: { white: { economicLean: 2, socialLean: 0.6 } },
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
    race: { white: 79, black: 3, hispanic: 7, asian: 6, other: 5 },
    education: { no_college: 65, college: 23, graduate: 12 },
    wealth: { low: 24, middle: 52, high: 24 },
    age: { young: 27, mid: 28, mature: 26, senior: 19 },
    ideology: {
      evangelicals: 10,
      environmentalists: 17,
      libertarians: 7,
      progressives: 16,
      patriots: 5,
      gunowners: 9,
    },
    positions: {
      race: { white: { economicLean: 1.7, socialLean: 0.8 } },
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
    race: { white: 87, black: 6, hispanic: 4, asian: 2, other: 1 },
    education: { no_college: 73, college: 19, graduate: 8 },
    wealth: { low: 25, middle: 56, high: 19 },
    age: { young: 26, mid: 26, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 14,
      environmentalists: 8,
      libertarians: 6,
      progressives: 12,
      patriots: 6,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: 2, socialLean: 1 } },
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
    race: { white: 95, black: 3, hispanic: 1, asian: 1, other: 0 },
    education: { no_college: 81, college: 13, graduate: 6 },
    wealth: { low: 42, middle: 46, high: 12 },
    age: { young: 23, mid: 25, mature: 27, senior: 25 },
    ideology: {
      evangelicals: 26,
      environmentalists: 3,
      libertarians: 4,
      progressives: 5,
      patriots: 12,
      gunowners: 22,
    },
    positions: {
      race: { white: { economicLean: 2.7, socialLean: 1.6 } },
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
  WY: {
    race: { white: 89, black: 1, hispanic: 6, asian: 1, other: 3 },
    education: { no_college: 71, college: 20, graduate: 9 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 26, mid: 26, mature: 27, senior: 21 },
    ideology: {
      evangelicals: 16,
      environmentalists: 5,
      libertarians: 13,
      progressives: 4,
      patriots: 13,
      gunowners: 22,
    },
    positions: {
      race: { white: { economicLean: 1.7, socialLean: 2 } },
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
