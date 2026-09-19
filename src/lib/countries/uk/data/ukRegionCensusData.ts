/**
 * UK Region Census Profiles — Layer 1 demographic breakdown per region.
 *
 * Mirrors the structure of the US `stateCensusData` / `Layer1Config` system,
 * adapted for UK census categories and ONS definitions.
 *
 * Source data: ONS Census 2021, HESA, DfE, DWP, ONS Regional Profiles.
 * All figures are approximate 2021-era estimates (% of adult population
 * unless otherwise noted).
 *
 * Fields:
 *   ethnicity  — ONS 2021 categories; unlike US "race", UK uses these groupings
 *   age        — Distribution of adult (18+) population
 *   education  — Highest qualification level (NVQ/equivalent)
 *   income     — Household income bands (approx)
 *   urbanization — Urban / suburban / rural split (ONS rural/urban classification)
 */

export interface UKRegionLayer1 {
  ethnicity: {
    white_british: number; // % White British / Irish
    asian_british: number; // % Asian / Asian British (Indian, Pakistani, Bangladeshi, Chinese, Other)
    black_british: number; // % Black / Black British (African, Caribbean, Other)
    mixed: number; // % Mixed / Multiple Ethnic Groups
    other: number; // % Other Ethnic Group (Arab, any other)
  };
  age: {
    young: number; // 18–29
    mid: number; // 30–44
    mature: number; // 45–64
    senior: number; // 65+
  };
  education: {
    no_qualifications: number; // No formal qualifications or below Level 2
    gcse_equivalent: number; // Level 2 (GCSE, NVQ2)
    a_level_equivalent: number; // Level 3 (A-levels, NVQ3)
    degree_plus: number; // Level 4+ (degree, postgraduate)
  };
  income: {
    low: number; // Below £20k household
    middle: number; // £20k–£50k household
    high: number; // Above £50k household
  };
  urbanization: {
    urban: number; // Major urban conurbation
    suburban: number; // Urban fringe / town
    rural: number; // Rural and village
  };
}

/**
 * Per-region census profiles. Keys match the State._id format used in the DB
 * (e.g. "LON", "SCO").
 *
 * Note: ethnicity percentages derived from ONS Census 2021 regional tables.
 * Age/education/income from NOMIS / ONS Annual Population Survey.
 */
export const ukRegionCensusData: Record<string, UKRegionLayer1> = {
  // ── London ──────────────────────────────────────────────────────────────────
  LON: {
    ethnicity: {
      white_british: 53, // Minority-majority city by ONS 2021
      asian_british: 20,
      black_british: 13,
      mixed: 6,
      other: 8,
    },
    age: { young: 22, mid: 30, mature: 28, senior: 20 },
    education: {
      no_qualifications: 8,
      gcse_equivalent: 20,
      a_level_equivalent: 22,
      degree_plus: 50,
    },
    income: { low: 25, middle: 45, high: 30 },
    urbanization: { urban: 98, suburban: 2, rural: 0 },
  },

  // ── South East England ──────────────────────────────────────────────────────
  SEE: {
    ethnicity: {
      white_british: 82,
      asian_british: 8,
      black_british: 3,
      mixed: 3,
      other: 4,
    },
    age: { young: 18, mid: 26, mature: 30, senior: 26 },
    education: {
      no_qualifications: 10,
      gcse_equivalent: 28,
      a_level_equivalent: 24,
      degree_plus: 38,
    },
    income: { low: 18, middle: 50, high: 32 },
    urbanization: { urban: 60, suburban: 28, rural: 12 },
  },

  // ── South West England ──────────────────────────────────────────────────────
  SWE: {
    ethnicity: {
      white_british: 94,
      asian_british: 2,
      black_british: 1,
      mixed: 2,
      other: 1,
    },
    age: { young: 16, mid: 24, mature: 30, senior: 30 },
    education: {
      no_qualifications: 12,
      gcse_equivalent: 30,
      a_level_equivalent: 25,
      degree_plus: 33,
    },
    income: { low: 22, middle: 53, high: 25 },
    urbanization: { urban: 42, suburban: 26, rural: 32 },
  },

  // ── East of England ─────────────────────────────────────────────────────────
  EAE: {
    ethnicity: {
      white_british: 83,
      asian_british: 8,
      black_british: 3,
      mixed: 3,
      other: 3,
    },
    age: { young: 17, mid: 25, mature: 30, senior: 28 },
    education: {
      no_qualifications: 11,
      gcse_equivalent: 28,
      a_level_equivalent: 24,
      degree_plus: 37,
    },
    income: { low: 20, middle: 52, high: 28 },
    urbanization: { urban: 52, suburban: 30, rural: 18 },
  },

  // ── East Midlands ───────────────────────────────────────────────────────────
  EMI: {
    ethnicity: {
      white_british: 84,
      asian_british: 7,
      black_british: 3,
      mixed: 3,
      other: 3,
    },
    age: { young: 17, mid: 25, mature: 30, senior: 28 },
    education: {
      no_qualifications: 13,
      gcse_equivalent: 30,
      a_level_equivalent: 25,
      degree_plus: 32,
    },
    income: { low: 24, middle: 53, high: 23 },
    urbanization: { urban: 55, suburban: 28, rural: 17 },
  },

  // ── West Midlands ───────────────────────────────────────────────────────────
  WMI: {
    ethnicity: {
      white_british: 70,
      asian_british: 16, // Large South Asian community (Sparkbrook, Handsworth, etc.)
      black_british: 8,
      mixed: 4,
      other: 2,
    },
    age: { young: 19, mid: 26, mature: 28, senior: 27 },
    education: {
      no_qualifications: 14,
      gcse_equivalent: 30,
      a_level_equivalent: 24,
      degree_plus: 32,
    },
    income: { low: 27, middle: 50, high: 23 },
    urbanization: { urban: 75, suburban: 18, rural: 7 },
  },

  // ── Yorkshire & the Humber ──────────────────────────────────────────────────
  YHU: {
    ethnicity: {
      white_british: 83,
      asian_british: 9, // Bradford, Kirklees Pakistani communities
      black_british: 3,
      mixed: 3,
      other: 2,
    },
    age: { young: 18, mid: 25, mature: 30, senior: 27 },
    education: {
      no_qualifications: 14,
      gcse_equivalent: 31,
      a_level_equivalent: 24,
      degree_plus: 31,
    },
    income: { low: 26, middle: 52, high: 22 },
    urbanization: { urban: 62, suburban: 24, rural: 14 },
  },

  // ── North West England ──────────────────────────────────────────────────────
  NWE: {
    ethnicity: {
      white_british: 80,
      asian_british: 10, // Manchester, Oldham, Blackburn communities
      black_british: 3,
      mixed: 3,
      other: 4,
    },
    age: { young: 19, mid: 26, mature: 29, senior: 26 },
    education: {
      no_qualifications: 13,
      gcse_equivalent: 30,
      a_level_equivalent: 25,
      degree_plus: 32,
    },
    income: { low: 27, middle: 51, high: 22 },
    urbanization: { urban: 76, suburban: 16, rural: 8 },
  },

  // ── North East England ──────────────────────────────────────────────────────
  NEE: {
    ethnicity: {
      white_british: 93, // Most ethnically homogeneous English region
      asian_british: 3,
      black_british: 1,
      mixed: 2,
      other: 1,
    },
    age: { young: 17, mid: 24, mature: 31, senior: 28 },
    // ONS Census 2021: NEE has the lowest degree share in England (~26.6%)
    // and one of the highest no-qualifications shares.
    education: {
      no_qualifications: 19,
      gcse_equivalent: 32,
      a_level_equivalent: 24,
      degree_plus: 25,
    },
    income: { low: 33, middle: 52, high: 15 }, // Highest low-income share in England
    urbanization: { urban: 58, suburban: 25, rural: 17 },
  },

  // ── Scotland ────────────────────────────────────────────────────────────────
  SCO: {
    ethnicity: {
      white_british: 93, // Includes White Scottish / White Other
      asian_british: 4,
      black_british: 1,
      mixed: 1,
      other: 1,
    },
    age: { young: 17, mid: 25, mature: 30, senior: 28 },
    education: {
      no_qualifications: 9,
      gcse_equivalent: 24,
      a_level_equivalent: 28,
      degree_plus: 39,
    },
    income: { low: 24, middle: 51, high: 25 },
    urbanization: { urban: 68, suburban: 18, rural: 14 },
  },

  // ── Wales ───────────────────────────────────────────────────────────────────
  WAL: {
    ethnicity: {
      white_british: 93, // Includes Welsh / English / Scottish identity
      asian_british: 3,
      black_british: 1,
      mixed: 2,
      other: 1,
    },
    age: { young: 18, mid: 24, mature: 30, senior: 28 },
    education: {
      no_qualifications: 14,
      gcse_equivalent: 30,
      a_level_equivalent: 25,
      degree_plus: 31,
    },
    // Wales has the lowest gross disposable household income of the four
    // nations; Valleys communities dominate the low-income tier.
    income: { low: 36, middle: 50, high: 14 },
    // ONS: ~2/3 of the Welsh population lives in urban areas (Cardiff/Swansea/
    // Newport + densely settled Valleys towns classified as urban).
    urbanization: { urban: 57, suburban: 25, rural: 18 },
  },

  // ── Northern Ireland ────────────────────────────────────────────────────────
  NIR: {
    ethnicity: {
      white_british: 96, // Predominantly White Irish / British
      asian_british: 2,
      black_british: 1,
      mixed: 1,
      other: 0,
    },
    age: { young: 19, mid: 26, mature: 29, senior: 26 },
    // NISRA Census 2021: NI has the HIGHEST no-qualifications share in the UK
    // (~24% of adults) and a below-GB degree share.
    education: {
      no_qualifications: 22,
      gcse_equivalent: 28,
      a_level_equivalent: 22,
      degree_plus: 28,
    },
    income: { low: 28, middle: 52, high: 20 },
    urbanization: { urban: 46, suburban: 28, rural: 26 },
  },
};
