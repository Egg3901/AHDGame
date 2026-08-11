import type { Layer1Config } from "./stateDemographics";

/**
 * 2023-era US state demographic profiles (Layer 1 configs).
 *
 * Era anchor: 2022–2023 American Community Survey (ACS) estimates, with
 * post-2020-census redistribution and pandemic-era migration baked in.
 *
 * Methodology: every state below was authored INDEPENDENTLY from
 * 2022–2023 reference knowledge of that state — these values are NOT
 * scaled or otherwise derived from the 2019 dataset in
 * `stateCensusData.ts` (that file was consulted only for the field
 * format and the ideology-share scale conventions).
 *
 * Key national reference points circa 2023:
 * - Race: non-Hispanic White ~58.5%, Black ~12%, Hispanic ~19.5%,
 *   Asian ~6.3%, multiracial/other share growing post-2020 census.
 * - Education: bachelor's-or-higher ~38% of adults nationally; the
 *   graduate-degree share continued climbing in metro/coastal states.
 * - Age: national median ~39; boomer retirement swelled the senior
 *   cohort almost everywhere (FL/ME/WV/VT oldest; UT/TX/DC youngest).
 * - Migration: pandemic-era booms in ID, MT, TN, FL, TX, SC, AZ, NV
 *   (younger in-migrants in boomtowns, retirees in FL/AZ/SC); slight
 *   population declines in CA, NY, IL.
 * - Ideology (independent shares; do not sum to 100): post-2020
 *   realignment — progressive and environmentalist identification
 *   elevated among the young and college-educated; white evangelical
 *   share in slow secular decline; gun-owner and patriot identification
 *   firm-to-rising in rural and exurban states.
 */
export const stateCensusData2023: Record<string, Layer1Config> = {
  AK: {
    race: { white: 59, black: 3, hispanic: 8, asian: 7, other: 23 },
    education: { no_college: 58, college: 30, graduate: 12 },
    wealth: { low: 22, middle: 56, high: 22 },
    age: { young: 26, mid: 26, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 16,
      environmentalists: 9,
      libertarians: 12,
      progressives: 9,
      patriots: 13,
      gunowners: 22,
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
  AL: {
    race: { white: 64, black: 26, hispanic: 5, asian: 2, other: 3 },
    education: { no_college: 62, college: 27, graduate: 11 },
    wealth: { low: 33, middle: 50, high: 17 },
    age: { young: 23, mid: 25, mature: 26, senior: 26 },
    ideology: {
      evangelicals: 35,
      environmentalists: 3,
      libertarians: 4,
      progressives: 6,
      patriots: 18,
      gunowners: 22,
    },
    positions: {
      race: { white: { economicLean: 2.5, socialLean: 2.5 } },
      ideology: {
        evangelicals: { economicLean: 4.0, socialLean: 4.0 },
        patriots: { economicLean: 3.5, socialLean: 3.5 },
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
    race: { white: 70, black: 15, hispanic: 9, asian: 2, other: 4 },
    education: { no_college: 65, college: 25, graduate: 10 },
    wealth: { low: 34, middle: 50, high: 16 },
    age: { young: 24, mid: 24, mature: 26, senior: 26 },
    ideology: {
      evangelicals: 33,
      environmentalists: 3,
      libertarians: 6,
      progressives: 5,
      patriots: 17,
      gunowners: 23,
    },
    positions: {
      race: { white: { economicLean: 1.5, socialLean: 1.5 } },
      ideology: {
        evangelicals: { economicLean: 3.0, socialLean: 3.0 },
        patriots: { economicLean: 2.5, socialLean: 2.5 },
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
    race: { white: 52, black: 5, hispanic: 32, asian: 4, other: 7 },
    education: { no_college: 58, college: 29, graduate: 13 },
    wealth: { low: 26, middle: 52, high: 22 },
    age: { young: 24, mid: 25, mature: 25, senior: 26 },
    ideology: {
      evangelicals: 15,
      environmentalists: 9,
      libertarians: 9,
      progressives: 12,
      patriots: 11,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 3.0, socialLean: 3.0 } },
      ideology: {
        evangelicals: { economicLean: 4.0, socialLean: 4.0 },
        patriots: { economicLean: 3.0, socialLean: 3.0 },
        gunowners: { economicLean: 3.5, socialLean: 3.5 },
        progressives: { economicLean: -1.0, socialLean: -1.0 },
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
    race: { white: 34, black: 5, hispanic: 40, asian: 16, other: 5 },
    education: { no_college: 51, college: 32, graduate: 17 },
    wealth: { low: 28, middle: 47, high: 25 },
    age: { young: 25, mid: 27, mature: 25, senior: 23 },
    ideology: {
      evangelicals: 8,
      environmentalists: 21,
      libertarians: 5,
      progressives: 24,
      patriots: 4,
      gunowners: 6,
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
  CO: {
    race: { white: 65, black: 4, hispanic: 22, asian: 4, other: 5 },
    education: { no_college: 48, college: 34, graduate: 18 },
    wealth: { low: 20, middle: 53, high: 27 },
    age: { young: 25, mid: 28, mature: 25, senior: 22 },
    ideology: {
      evangelicals: 11,
      environmentalists: 18,
      libertarians: 9,
      progressives: 18,
      patriots: 6,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: -1.0, socialLean: -1.0 } },
      ideology: {
        evangelicals: { economicLean: 1.0, socialLean: 1.0 },
        patriots: { economicLean: 1.0, socialLean: 1.0 },
        gunowners: { economicLean: 1.0, socialLean: 1.0 },
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
  CT: {
    race: { white: 63, black: 11, hispanic: 18, asian: 5, other: 3 },
    education: { no_college: 50, college: 30, graduate: 20 },
    wealth: { low: 22, middle: 50, high: 28 },
    age: { young: 22, mid: 24, mature: 27, senior: 27 },
    ideology: {
      evangelicals: 5,
      environmentalists: 18,
      libertarians: 5,
      progressives: 24,
      patriots: 3,
      gunowners: 5,
    },
    positions: {
      race: { white: { economicLean: -1.0, socialLean: -1.0 } },
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
  DC: {
    race: { white: 38, black: 41, hispanic: 12, asian: 5, other: 4 },
    education: { no_college: 34, college: 32, graduate: 34 },
    wealth: { low: 28, middle: 40, high: 32 },
    age: { young: 28, mid: 31, mature: 23, senior: 18 },
    ideology: {
      evangelicals: 5,
      environmentalists: 18,
      libertarians: 3,
      progressives: 32,
      patriots: 2,
      gunowners: 3,
    },
    positions: {
      race: { white: { economicLean: -3.0, socialLean: -3.0 } },
      ideology: {
        evangelicals: { economicLean: -1.0, socialLean: -1.0 },
        patriots: { economicLean: -1.5, socialLean: -1.5 },
        gunowners: { economicLean: -1.0, socialLean: -1.0 },
        progressives: { economicLean: -5.5, socialLean: -5.5 },
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
    race: { white: 58, black: 22, hispanic: 11, asian: 4, other: 5 },
    education: { no_college: 54, college: 30, graduate: 16 },
    wealth: { low: 25, middle: 52, high: 23 },
    age: { young: 22, mid: 24, mature: 26, senior: 28 },
    ideology: {
      evangelicals: 7,
      environmentalists: 16,
      libertarians: 5,
      progressives: 22,
      patriots: 4,
      gunowners: 6,
    },
    positions: {
      race: { white: { economicLean: -1.0, socialLean: -1.0 } },
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
  FL: {
    race: { white: 51, black: 15, hispanic: 27, asian: 3, other: 4 },
    education: { no_college: 58, college: 29, graduate: 13 },
    wealth: { low: 28, middle: 51, high: 21 },
    age: { young: 21, mid: 24, mature: 26, senior: 29 },
    ideology: {
      evangelicals: 16,
      environmentalists: 7,
      libertarians: 7,
      progressives: 11,
      patriots: 12,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: -1.0, socialLean: -1.0 } },
      ideology: {
        evangelicals: { economicLean: 1.0, socialLean: 1.0 },
        patriots: { economicLean: 1.0, socialLean: 1.0 },
        gunowners: { economicLean: 1.0, socialLean: 1.0 },
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
  GA: {
    race: { white: 50, black: 32, hispanic: 10, asian: 4, other: 4 },
    education: { no_college: 57, college: 29, graduate: 14 },
    wealth: { low: 28, middle: 51, high: 21 },
    age: { young: 25, mid: 27, mature: 26, senior: 22 },
    ideology: {
      evangelicals: 24,
      environmentalists: 7,
      libertarians: 5,
      progressives: 13,
      patriots: 12,
      gunowners: 15,
    },
    positions: {
      race: { white: { economicLean: 2.5, socialLean: 2.5 } },
      ideology: {
        evangelicals: { economicLean: 4.0, socialLean: 4.0 },
        patriots: { economicLean: 3.0, socialLean: 3.0 },
        gunowners: { economicLean: 3.5, socialLean: 3.5 },
        progressives: { economicLean: -1.5, socialLean: -1.5 },
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
  HI: {
    race: { white: 21, black: 2, hispanic: 10, asian: 36, other: 31 },
    education: { no_college: 54, college: 32, graduate: 14 },
    wealth: { low: 24, middle: 52, high: 24 },
    age: { young: 22, mid: 25, mature: 26, senior: 27 },
    ideology: {
      evangelicals: 8,
      environmentalists: 19,
      libertarians: 3,
      progressives: 22,
      patriots: 3,
      gunowners: 4,
    },
    positions: {
      race: { white: { economicLean: -1.5, socialLean: -1.5 } },
      ideology: {
        evangelicals: { economicLean: 0.0, socialLean: 0.0 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
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
  IA: {
    race: { white: 83, black: 4, hispanic: 7, asian: 3, other: 3 },
    education: { no_college: 60, college: 29, graduate: 11 },
    wealth: { low: 24, middle: 58, high: 18 },
    age: { young: 24, mid: 24, mature: 26, senior: 26 },
    ideology: {
      evangelicals: 21,
      environmentalists: 6,
      libertarians: 8,
      progressives: 9,
      patriots: 12,
      gunowners: 16,
    },
    positions: {
      race: { white: { economicLean: -1.5, socialLean: -1.5 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
        gunowners: { economicLean: 0.5, socialLean: 0.5 },
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
    race: { white: 80, black: 1, hispanic: 13, asian: 2, other: 4 },
    education: { no_college: 60, college: 29, graduate: 11 },
    wealth: { low: 24, middle: 57, high: 19 },
    age: { young: 26, mid: 26, mature: 25, senior: 23 },
    ideology: {
      evangelicals: 24,
      environmentalists: 5,
      libertarians: 13,
      progressives: 5,
      patriots: 17,
      gunowners: 23,
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
  IL: {
    race: { white: 59, black: 14, hispanic: 18, asian: 6, other: 3 },
    education: { no_college: 53, college: 30, graduate: 17 },
    wealth: { low: 25, middle: 51, high: 24 },
    age: { young: 24, mid: 26, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 11,
      environmentalists: 14,
      libertarians: 5,
      progressives: 20,
      patriots: 5,
      gunowners: 8,
    },
    positions: {
      race: { white: { economicLean: -1.0, socialLean: -1.0 } },
      ideology: {
        evangelicals: { economicLean: 1.0, socialLean: 1.0 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
        gunowners: { economicLean: 1.0, socialLean: 1.0 },
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
  IN: {
    race: { white: 76, black: 9, hispanic: 8, asian: 3, other: 4 },
    education: { no_college: 62, college: 27, graduate: 11 },
    wealth: { low: 26, middle: 55, high: 19 },
    age: { young: 25, mid: 25, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 23,
      environmentalists: 5,
      libertarians: 8,
      progressives: 8,
      patriots: 14,
      gunowners: 17,
    },
    positions: {
      race: { white: { economicLean: 1.0, socialLean: 1.0 } },
      ideology: {
        evangelicals: { economicLean: 2.0, socialLean: 2.0 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
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
    race: { white: 74, black: 5, hispanic: 13, asian: 3, other: 5 },
    education: { no_college: 56, college: 31, graduate: 13 },
    wealth: { low: 24, middle: 56, high: 20 },
    age: { young: 25, mid: 25, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 22,
      environmentalists: 5,
      libertarians: 9,
      progressives: 8,
      patriots: 13,
      gunowners: 17,
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
  KY: {
    race: { white: 83, black: 8, hispanic: 4, asian: 2, other: 3 },
    education: { no_college: 64, college: 25, graduate: 11 },
    wealth: { low: 33, middle: 51, high: 16 },
    age: { young: 23, mid: 25, mature: 26, senior: 26 },
    ideology: {
      evangelicals: 31,
      environmentalists: 4,
      libertarians: 6,
      progressives: 6,
      patriots: 16,
      gunowners: 22,
    },
    positions: {
      race: { white: { economicLean: 1.5, socialLean: 1.5 } },
      ideology: {
        evangelicals: { economicLean: 3.0, socialLean: 3.0 },
        patriots: { economicLean: 2.5, socialLean: 2.5 },
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
    race: { white: 57, black: 32, hispanic: 6, asian: 2, other: 3 },
    education: { no_college: 64, college: 25, graduate: 11 },
    wealth: { low: 35, middle: 49, high: 16 },
    age: { young: 24, mid: 25, mature: 26, senior: 25 },
    ideology: {
      evangelicals: 27,
      environmentalists: 4,
      libertarians: 4,
      progressives: 9,
      patriots: 15,
      gunowners: 19,
    },
    positions: {
      race: { white: { economicLean: 1.5, socialLean: 1.5 } },
      ideology: {
        evangelicals: { economicLean: 3.0, socialLean: 3.0 },
        patriots: { economicLean: 2.5, socialLean: 2.5 },
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
    race: { white: 67, black: 9, hispanic: 13, asian: 8, other: 3 },
    education: { no_college: 43, college: 31, graduate: 26 },
    wealth: { low: 21, middle: 47, high: 32 },
    age: { young: 24, mid: 26, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 4,
      environmentalists: 20,
      libertarians: 4,
      progressives: 26,
      patriots: 3,
      gunowners: 4,
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
  MD: {
    race: { white: 47, black: 30, hispanic: 12, asian: 7, other: 4 },
    education: { no_college: 47, college: 30, graduate: 23 },
    wealth: { low: 21, middle: 50, high: 29 },
    age: { young: 23, mid: 27, mature: 27, senior: 23 },
    ideology: {
      evangelicals: 8,
      environmentalists: 17,
      libertarians: 4,
      progressives: 25,
      patriots: 3,
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
    race: { white: 91, black: 2, hispanic: 2, asian: 1, other: 4 },
    education: { no_college: 55, college: 29, graduate: 16 },
    wealth: { low: 27, middle: 54, high: 19 },
    age: { young: 19, mid: 23, mature: 27, senior: 31 },
    ideology: {
      evangelicals: 6,
      environmentalists: 19,
      libertarians: 7,
      progressives: 19,
      patriots: 5,
      gunowners: 9,
    },
    positions: {
      race: { white: { economicLean: -1.0, socialLean: -1.0 } },
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
  MI: {
    race: { white: 73, black: 13, hispanic: 6, asian: 3, other: 5 },
    education: { no_college: 58, college: 28, graduate: 14 },
    wealth: { low: 27, middle: 53, high: 20 },
    age: { young: 23, mid: 24, mature: 27, senior: 26 },
    ideology: {
      evangelicals: 15,
      environmentalists: 11,
      libertarians: 6,
      progressives: 15,
      patriots: 9,
      gunowners: 13,
    },
    positions: {
      race: { white: { economicLean: 0.0, socialLean: 0.0 } },
      ideology: {
        evangelicals: { economicLean: 2.0, socialLean: 2.0 },
        patriots: { economicLean: 1.0, socialLean: 1.0 },
        gunowners: { economicLean: 2.0, socialLean: 2.0 },
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
  MN: {
    race: { white: 76, black: 7, hispanic: 6, asian: 5, other: 6 },
    education: { no_college: 51, college: 34, graduate: 15 },
    wealth: { low: 21, middle: 55, high: 24 },
    age: { young: 24, mid: 26, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 14,
      environmentalists: 15,
      libertarians: 6,
      progressives: 17,
      patriots: 6,
      gunowners: 11,
    },
    positions: {
      race: { white: { economicLean: -1.5, socialLean: -1.5 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.0, socialLean: 0.0 },
        gunowners: { economicLean: 0.5, socialLean: 0.5 },
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
  MO: {
    race: { white: 76, black: 11, hispanic: 5, asian: 2, other: 6 },
    education: { no_college: 60, college: 27, graduate: 13 },
    wealth: { low: 29, middle: 53, high: 18 },
    age: { young: 24, mid: 25, mature: 25, senior: 26 },
    ideology: {
      evangelicals: 25,
      environmentalists: 5,
      libertarians: 7,
      progressives: 8,
      patriots: 14,
      gunowners: 19,
    },
    positions: {
      race: { white: { economicLean: 1.0, socialLean: 1.0 } },
      ideology: {
        evangelicals: { economicLean: 2.5, socialLean: 2.5 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
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
    race: { white: 55, black: 37, hispanic: 4, asian: 1, other: 3 },
    education: { no_college: 66, college: 24, graduate: 10 },
    wealth: { low: 38, middle: 48, high: 14 },
    age: { young: 25, mid: 24, mature: 26, senior: 25 },
    ideology: {
      evangelicals: 31,
      environmentalists: 3,
      libertarians: 3,
      progressives: 8,
      patriots: 13,
      gunowners: 17,
    },
    positions: {
      race: { white: { economicLean: 2.5, socialLean: 2.5 } },
      ideology: {
        evangelicals: { economicLean: 4.0, socialLean: 4.0 },
        patriots: { economicLean: 3.5, socialLean: 3.5 },
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
    race: { white: 84, black: 1, hispanic: 4, asian: 1, other: 10 },
    education: { no_college: 56, college: 31, graduate: 13 },
    wealth: { low: 26, middle: 56, high: 18 },
    age: { young: 23, mid: 24, mature: 26, senior: 27 },
    ideology: {
      evangelicals: 17,
      environmentalists: 9,
      libertarians: 12,
      progressives: 8,
      patriots: 15,
      gunowners: 25,
    },
    positions: {
      race: { white: { economicLean: 2.0, socialLean: 2.0 } },
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
  NC: {
    race: { white: 60, black: 21, hispanic: 11, asian: 3, other: 5 },
    education: { no_college: 55, college: 30, graduate: 15 },
    wealth: { low: 28, middle: 52, high: 20 },
    age: { young: 24, mid: 26, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 23,
      environmentalists: 8,
      libertarians: 6,
      progressives: 12,
      patriots: 12,
      gunowners: 15,
    },
    positions: {
      race: { white: { economicLean: 1.0, socialLean: 1.0 } },
      ideology: {
        evangelicals: { economicLean: 2.0, socialLean: 2.0 },
        patriots: { economicLean: 2.0, socialLean: 2.0 },
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
    race: { white: 82, black: 3, hispanic: 4, asian: 2, other: 9 },
    education: { no_college: 58, college: 31, graduate: 11 },
    wealth: { low: 22, middle: 58, high: 20 },
    age: { young: 27, mid: 26, mature: 25, senior: 22 },
    ideology: {
      evangelicals: 21,
      environmentalists: 4,
      libertarians: 9,
      progressives: 5,
      patriots: 15,
      gunowners: 22,
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
  NE: {
    race: { white: 76, black: 5, hispanic: 12, asian: 3, other: 4 },
    education: { no_college: 56, college: 32, graduate: 12 },
    wealth: { low: 22, middle: 58, high: 20 },
    age: { young: 26, mid: 25, mature: 25, senior: 24 },
    ideology: {
      evangelicals: 22,
      environmentalists: 5,
      libertarians: 8,
      progressives: 7,
      patriots: 13,
      gunowners: 17,
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
  NH: {
    race: { white: 88, black: 2, hispanic: 5, asian: 3, other: 2 },
    education: { no_college: 49, college: 33, graduate: 18 },
    wealth: { low: 18, middle: 53, high: 29 },
    age: { young: 20, mid: 24, mature: 28, senior: 28 },
    ideology: {
      evangelicals: 5,
      environmentalists: 16,
      libertarians: 11,
      progressives: 18,
      patriots: 5,
      gunowners: 9,
    },
    positions: {
      race: { white: { economicLean: -2.0, socialLean: -2.0 } },
      ideology: {
        evangelicals: { economicLean: -0.5, socialLean: -0.5 },
        patriots: { economicLean: -1.0, socialLean: -1.0 },
        gunowners: { economicLean: -1.0, socialLean: -1.0 },
        progressives: { economicLean: -5.5, socialLean: -5.5 },
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
    race: { white: 52, black: 13, hispanic: 22, asian: 10, other: 3 },
    education: { no_college: 47, college: 32, graduate: 21 },
    wealth: { low: 22, middle: 48, high: 30 },
    age: { young: 23, mid: 26, mature: 27, senior: 24 },
    ideology: {
      evangelicals: 6,
      environmentalists: 17,
      libertarians: 4,
      progressives: 23,
      patriots: 4,
      gunowners: 4,
    },
    positions: {
      race: { white: { economicLean: -1.0, socialLean: -1.0 } },
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
  NM: {
    race: { white: 35, black: 2, hispanic: 50, asian: 2, other: 11 },
    education: { no_college: 60, college: 26, graduate: 14 },
    wealth: { low: 34, middle: 49, high: 17 },
    age: { young: 24, mid: 24, mature: 26, senior: 26 },
    ideology: {
      evangelicals: 13,
      environmentalists: 12,
      libertarians: 6,
      progressives: 16,
      patriots: 8,
      gunowners: 13,
    },
    positions: {
      race: { white: { economicLean: -2.0, socialLean: -2.0 } },
      ideology: {
        evangelicals: { economicLean: 0.0, socialLean: 0.0 },
        patriots: { economicLean: 0.0, socialLean: 0.0 },
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
  NV: {
    race: { white: 44, black: 10, hispanic: 30, asian: 9, other: 7 },
    education: { no_college: 64, college: 26, graduate: 10 },
    wealth: { low: 27, middle: 53, high: 20 },
    age: { young: 24, mid: 26, mature: 26, senior: 24 },
    ideology: {
      evangelicals: 11,
      environmentalists: 9,
      libertarians: 10,
      progressives: 13,
      patriots: 8,
      gunowners: 12,
    },
    positions: {
      race: { white: { economicLean: -0.5, socialLean: -0.5 } },
      ideology: {
        evangelicals: { economicLean: 1.5, socialLean: 1.5 },
        patriots: { economicLean: 1.0, socialLean: 1.0 },
        gunowners: { economicLean: 1.5, socialLean: 1.5 },
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
  NY: {
    race: { white: 52, black: 17, hispanic: 20, asian: 9, other: 2 },
    education: { no_college: 49, college: 29, graduate: 22 },
    wealth: { low: 27, middle: 46, high: 27 },
    age: { young: 24, mid: 27, mature: 25, senior: 24 },
    ideology: {
      evangelicals: 6,
      environmentalists: 17,
      libertarians: 4,
      progressives: 24,
      patriots: 3,
      gunowners: 5,
    },
    positions: {
      race: { white: { economicLean: -1.5, socialLean: -1.5 } },
      ideology: {
        evangelicals: { economicLean: 0.0, socialLean: 0.0 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
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
  OH: {
    race: { white: 76, black: 12, hispanic: 5, asian: 3, other: 4 },
    education: { no_college: 60, college: 27, graduate: 13 },
    wealth: { low: 28, middle: 53, high: 19 },
    age: { young: 23, mid: 24, mature: 27, senior: 26 },
    ideology: {
      evangelicals: 19,
      environmentalists: 6,
      libertarians: 7,
      progressives: 11,
      patriots: 13,
      gunowners: 16,
    },
    positions: {
      race: { white: { economicLean: -1.0, socialLean: -1.0 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
        gunowners: { economicLean: 0.5, socialLean: 0.5 },
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
  OK: {
    race: { white: 61, black: 7, hispanic: 13, asian: 2, other: 17 },
    education: { no_college: 64, college: 26, graduate: 10 },
    wealth: { low: 32, middle: 52, high: 16 },
    age: { young: 25, mid: 25, mature: 25, senior: 25 },
    ideology: {
      evangelicals: 32,
      environmentalists: 3,
      libertarians: 7,
      progressives: 5,
      patriots: 17,
      gunowners: 23,
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
  OR: {
    race: { white: 72, black: 2, hispanic: 14, asian: 5, other: 7 },
    education: { no_college: 51, college: 32, graduate: 17 },
    wealth: { low: 26, middle: 53, high: 21 },
    age: { young: 22, mid: 26, mature: 26, senior: 26 },
    ideology: {
      evangelicals: 11,
      environmentalists: 22,
      libertarians: 7,
      progressives: 21,
      patriots: 5,
      gunowners: 10,
    },
    positions: {
      race: { white: { economicLean: -1.0, socialLean: -1.0 } },
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
  PA: {
    race: { white: 73, black: 11, hispanic: 9, asian: 4, other: 3 },
    education: { no_college: 55, college: 29, graduate: 16 },
    wealth: { low: 26, middle: 53, high: 21 },
    age: { young: 22, mid: 24, mature: 26, senior: 28 },
    ideology: {
      evangelicals: 14,
      environmentalists: 10,
      libertarians: 6,
      progressives: 15,
      patriots: 9,
      gunowners: 13,
    },
    positions: {
      race: { white: { economicLean: 1.0, socialLean: 1.0 } },
      ideology: {
        evangelicals: { economicLean: 2.0, socialLean: 2.0 },
        patriots: { economicLean: 1.0, socialLean: 1.0 },
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
  RI: {
    race: { white: 68, black: 7, hispanic: 17, asian: 4, other: 4 },
    education: { no_college: 53, college: 29, graduate: 18 },
    wealth: { low: 26, middle: 51, high: 23 },
    age: { young: 23, mid: 25, mature: 26, senior: 26 },
    ideology: {
      evangelicals: 5,
      environmentalists: 17,
      libertarians: 5,
      progressives: 23,
      patriots: 4,
      gunowners: 5,
    },
    positions: {
      race: { white: { economicLean: -1.5, socialLean: -1.5 } },
      ideology: {
        evangelicals: { economicLean: 0.0, socialLean: 0.0 },
        patriots: { economicLean: -0.5, socialLean: -0.5 },
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
  SC: {
    race: { white: 62, black: 26, hispanic: 7, asian: 2, other: 3 },
    education: { no_college: 59, college: 28, graduate: 13 },
    wealth: { low: 30, middle: 51, high: 19 },
    age: { young: 23, mid: 25, mature: 25, senior: 27 },
    ideology: {
      evangelicals: 28,
      environmentalists: 4,
      libertarians: 5,
      progressives: 9,
      patriots: 15,
      gunowners: 18,
    },
    positions: {
      race: { white: { economicLean: 2.5, socialLean: 2.5 } },
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
  SD: {
    race: { white: 80, black: 2, hispanic: 5, asian: 2, other: 11 },
    education: { no_college: 60, college: 29, graduate: 11 },
    wealth: { low: 24, middle: 57, high: 19 },
    age: { young: 26, mid: 24, mature: 25, senior: 25 },
    ideology: {
      evangelicals: 25,
      environmentalists: 4,
      libertarians: 9,
      progressives: 5,
      patriots: 15,
      gunowners: 22,
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
  TN: {
    race: { white: 71, black: 16, hispanic: 7, asian: 2, other: 4 },
    education: { no_college: 60, college: 27, graduate: 13 },
    wealth: { low: 30, middle: 52, high: 18 },
    age: { young: 23, mid: 26, mature: 26, senior: 25 },
    ideology: {
      evangelicals: 32,
      environmentalists: 4,
      libertarians: 6,
      progressives: 7,
      patriots: 16,
      gunowners: 20,
    },
    positions: {
      race: { white: { economicLean: 2.0, socialLean: 2.0 } },
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
  TX: {
    race: { white: 39, black: 12, hispanic: 41, asian: 6, other: 2 },
    education: { no_college: 58, college: 29, graduate: 13 },
    wealth: { low: 28, middle: 51, high: 21 },
    age: { young: 27, mid: 27, mature: 25, senior: 21 },
    ideology: {
      evangelicals: 19,
      environmentalists: 6,
      libertarians: 9,
      progressives: 11,
      patriots: 12,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 2.0, socialLean: 2.0 } },
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
  UT: {
    race: { white: 75, black: 1, hispanic: 15, asian: 3, other: 6 },
    education: { no_college: 52, college: 34, graduate: 14 },
    wealth: { low: 18, middle: 58, high: 24 },
    age: { young: 31, mid: 28, mature: 22, senior: 19 },
    ideology: {
      evangelicals: 28,
      environmentalists: 6,
      libertarians: 10,
      progressives: 7,
      patriots: 10,
      gunowners: 11,
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
  VA: {
    race: { white: 58, black: 19, hispanic: 11, asian: 7, other: 5 },
    education: { no_college: 49, college: 31, graduate: 20 },
    wealth: { low: 23, middle: 51, high: 26 },
    age: { young: 24, mid: 27, mature: 26, senior: 23 },
    ideology: {
      evangelicals: 16,
      environmentalists: 11,
      libertarians: 6,
      progressives: 16,
      patriots: 8,
      gunowners: 11,
    },
    positions: {
      race: { white: { economicLean: -1.0, socialLean: -1.0 } },
      ideology: {
        evangelicals: { economicLean: 0.5, socialLean: 0.5 },
        patriots: { economicLean: 0.5, socialLean: 0.5 },
        gunowners: { economicLean: 0.5, socialLean: 0.5 },
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
  VT: {
    race: { white: 90, black: 1, hispanic: 2, asian: 2, other: 5 },
    education: { no_college: 48, college: 31, graduate: 21 },
    wealth: { low: 25, middle: 54, high: 21 },
    age: { young: 21, mid: 23, mature: 27, senior: 29 },
    ideology: {
      evangelicals: 4,
      environmentalists: 24,
      libertarians: 6,
      progressives: 26,
      patriots: 3,
      gunowners: 8,
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
  WA: {
    race: { white: 64, black: 4, hispanic: 14, asian: 10, other: 8 },
    education: { no_college: 49, college: 33, graduate: 18 },
    wealth: { low: 22, middle: 51, high: 27 },
    age: { young: 24, mid: 27, mature: 26, senior: 23 },
    ideology: {
      evangelicals: 10,
      environmentalists: 22,
      libertarians: 7,
      progressives: 22,
      patriots: 5,
      gunowners: 9,
    },
    positions: {
      race: { white: { economicLean: -1.0, socialLean: -1.0 } },
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
  WI: {
    race: { white: 79, black: 6, hispanic: 8, asian: 3, other: 4 },
    education: { no_college: 57, college: 30, graduate: 13 },
    wealth: { low: 24, middle: 56, high: 20 },
    age: { young: 24, mid: 24, mature: 26, senior: 26 },
    ideology: {
      evangelicals: 16,
      environmentalists: 11,
      libertarians: 7,
      progressives: 14,
      patriots: 9,
      gunowners: 14,
    },
    positions: {
      race: { white: { economicLean: 0.0, socialLean: 0.0 } },
      ideology: {
        evangelicals: { economicLean: 2.0, socialLean: 2.0 },
        patriots: { economicLean: 1.0, socialLean: 1.0 },
        gunowners: { economicLean: 2.0, socialLean: 2.0 },
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
  WV: {
    race: { white: 90, black: 4, hispanic: 2, asian: 1, other: 3 },
    education: { no_college: 69, college: 21, graduate: 10 },
    wealth: { low: 38, middle: 48, high: 14 },
    age: { young: 20, mid: 23, mature: 27, senior: 30 },
    ideology: {
      evangelicals: 30,
      environmentalists: 3,
      libertarians: 5,
      progressives: 5,
      patriots: 19,
      gunowners: 26,
    },
    positions: {
      // Post-2020 WV: deepest-red state (Trump +39 in 2024); econ
      // populist-right, strongly social-right.
      race: { white: { economicLean: 1.5, socialLean: 2.0 } },
      ideology: {
        evangelicals: { economicLean: 3.5, socialLean: 4.5 },
        patriots: { economicLean: 3.0, socialLean: 3.5 },
        gunowners: { economicLean: 3.0, socialLean: 3.5 },
        progressives: { economicLean: -4.5, socialLean: -4.5 },
      },
      education: {
        no_college: { economicLean: 1.5, socialLean: 2.5 },
      },
      wealth: {
        middle: { economicLean: 0.3, socialLean: 0.8 },
      },
      age: {
        senior: { economicLean: 1.0, socialLean: 2.0 },
      },
    },
  },
  WY: {
    race: { white: 82, black: 1, hispanic: 11, asian: 1, other: 5 },
    education: { no_college: 60, college: 28, graduate: 12 },
    wealth: { low: 22, middle: 58, high: 20 },
    age: { young: 23, mid: 25, mature: 27, senior: 25 },
    ideology: {
      evangelicals: 17,
      environmentalists: 5,
      libertarians: 15,
      progressives: 4,
      patriots: 16,
      gunowners: 26,
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
};
