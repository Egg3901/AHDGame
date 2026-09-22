/**
 * Germany Region Census Profiles — Layer 1 demographic breakdown per Bundesland.
 *
 * Mirrors the structure of ukRegionCensusData and jpRegionCensusData, adapted
 * for German census categories (Destatis Zensus 2022, Mikrozensus, BAMF).
 *
 * All values are approximate 2022–2023 estimates (% of adult population).
 *
 * Fields:
 *   ethnicity    — Destatis / BAMF Migrationshintergrund groupings
 *   age          — Adult (18+) population distribution
 *   education    — Highest qualification attained (Bildungsabschluss)
 *   income       — Household income bands (EUR/year)
 *   urbanization — Großstadt (urban ≥100k) / Kleinstadt (suburban 20k–100k) /
 *                  Ländlich (rural <20k) split per Destatis classification
 */

export interface DERegionLayer1 {
  ethnicity: {
    german: number; // % ohne Migrationshintergrund
    turkish_russian_diaspora: number; // % Turkish + Russian-German Aussiedler (largest migrant backgrounds)
    mena: number; // % Middle East / North African
    eu_southern_eastern: number; // % EU Southern + Eastern European
    other: number; // % Other (Sub-Saharan, South/East Asian, etc.)
  };
  age: {
    young: number; // 18–29
    mid: number; // 30–44
    mature: number; // 45–64
    senior: number; // 65+
  };
  education: {
    no_degree: number; // Kein / Hauptschulabschluss ohne Berufsausbildung
    berufsausbildung: number; // Lehre / Fachschule (vocational)
    abitur: number; // Abitur / Fachhochschulreife
    hochschulabschluss: number; // Hochschulabschluss (degree)
  };
  income: {
    low: number; // < €25k household
    middle: number; // €25k–€70k household
    high: number; // > €70k household
  };
  urbanization: {
    urban: number; // Großstadt (≥100k)
    suburban: number; // Kleinstadt (20k–100k)
    rural: number; // Ländlich (<20k)
  };
}

/**
 * Per-Land census profiles. Keys match State._id (e.g. "BW", "SN").
 *
 * Sources: Destatis Zensus 2022, Regionale Mikrozensus tables, BAMF
 * integration reports, Wegweiser Kommune.
 */
export const deRegionCensusData: Record<string, DERegionLayer1> = {
  // ── Süden ──────────────────────────────────────────────────────────────────
  BW: {
    ethnicity: {
      german: 83,
      turkish_russian_diaspora: 7,
      mena: 3,
      eu_southern_eastern: 4,
      other: 3,
    },
    age: { young: 15, mid: 22, mature: 38, senior: 25 },
    education: { no_degree: 12, berufsausbildung: 42, abitur: 21, hochschulabschluss: 25 },
    income: { low: 18, middle: 52, high: 30 },
    urbanization: { urban: 50, suburban: 35, rural: 15 },
  },
  BY: {
    ethnicity: {
      german: 85,
      turkish_russian_diaspora: 6,
      mena: 3,
      eu_southern_eastern: 3,
      other: 3,
    },
    age: { young: 15, mid: 21, mature: 38, senior: 26 },
    education: { no_degree: 12, berufsausbildung: 43, abitur: 21, hochschulabschluss: 24 },
    income: { low: 18, middle: 52, high: 30 },
    urbanization: { urban: 45, suburban: 30, rural: 25 },
  },

  // ── Westen ─────────────────────────────────────────────────────────────────
  NW: {
    ethnicity: {
      german: 79,
      turkish_russian_diaspora: 8,
      mena: 4,
      eu_southern_eastern: 5,
      other: 4,
    },
    age: { young: 15, mid: 22, mature: 37, senior: 26 },
    education: { no_degree: 14, berufsausbildung: 42, abitur: 20, hochschulabschluss: 24 },
    income: { low: 22, middle: 52, high: 26 },
    urbanization: { urban: 60, suburban: 28, rural: 12 },
  },
  HE: {
    ethnicity: {
      german: 81,
      turkish_russian_diaspora: 6,
      mena: 4,
      eu_southern_eastern: 5,
      other: 4,
    },
    age: { young: 15, mid: 23, mature: 37, senior: 25 },
    education: { no_degree: 12, berufsausbildung: 38, abitur: 22, hochschulabschluss: 28 },
    income: { low: 20, middle: 50, high: 30 },
    urbanization: { urban: 48, suburban: 32, rural: 20 },
  },
  RP: {
    ethnicity: {
      german: 86,
      turkish_russian_diaspora: 5,
      mena: 3,
      eu_southern_eastern: 3,
      other: 3,
    },
    age: { young: 15, mid: 21, mature: 38, senior: 26 },
    education: { no_degree: 13, berufsausbildung: 45, abitur: 19, hochschulabschluss: 23 },
    income: { low: 21, middle: 54, high: 25 },
    urbanization: { urban: 33, suburban: 35, rural: 32 },
  },
  SL: {
    ethnicity: {
      german: 87,
      turkish_russian_diaspora: 5,
      mena: 2,
      eu_southern_eastern: 4,
      other: 2,
    },
    age: { young: 13, mid: 20, mature: 38, senior: 29 },
    education: { no_degree: 13, berufsausbildung: 49, abitur: 17, hochschulabschluss: 21 },
    income: { low: 24, middle: 55, high: 21 },
    urbanization: { urban: 35, suburban: 40, rural: 25 },
  },

  // ── Norden ─────────────────────────────────────────────────────────────────
  NI: {
    ethnicity: {
      german: 88,
      turkish_russian_diaspora: 5,
      mena: 2,
      eu_southern_eastern: 3,
      other: 2,
    },
    age: { young: 15, mid: 21, mature: 38, senior: 26 },
    education: { no_degree: 14, berufsausbildung: 46, abitur: 19, hochschulabschluss: 21 },
    income: { low: 22, middle: 53, high: 25 },
    urbanization: { urban: 38, suburban: 30, rural: 32 },
  },
  SH: {
    ethnicity: {
      german: 90,
      turkish_russian_diaspora: 4,
      mena: 2,
      eu_southern_eastern: 2,
      other: 2,
    },
    age: { young: 14, mid: 21, mature: 38, senior: 27 },
    education: { no_degree: 12, berufsausbildung: 44, abitur: 20, hochschulabschluss: 24 },
    income: { low: 22, middle: 53, high: 25 },
    urbanization: { urban: 30, suburban: 35, rural: 35 },
  },
  HH: {
    ethnicity: {
      german: 78,
      turkish_russian_diaspora: 6,
      mena: 5,
      eu_southern_eastern: 6,
      other: 5,
    },
    age: { young: 17, mid: 26, mature: 32, senior: 25 },
    education: { no_degree: 12, berufsausbildung: 32, abitur: 22, hochschulabschluss: 34 },
    income: { low: 22, middle: 45, high: 33 },
    urbanization: { urban: 100, suburban: 0, rural: 0 },
  },
  BRE: {
    ethnicity: {
      german: 77,
      turkish_russian_diaspora: 7,
      mena: 6,
      eu_southern_eastern: 5,
      other: 5,
    },
    age: { young: 17, mid: 25, mature: 33, senior: 25 },
    education: { no_degree: 14, berufsausbildung: 38, abitur: 20, hochschulabschluss: 28 },
    income: { low: 27, middle: 50, high: 23 },
    urbanization: { urban: 98, suburban: 2, rural: 0 },
  },

  // ── Osten ──────────────────────────────────────────────────────────────────
  BE: {
    ethnicity: {
      german: 69,
      turkish_russian_diaspora: 11,
      mena: 8,
      eu_southern_eastern: 7,
      other: 5,
    },
    age: { young: 18, mid: 27, mature: 32, senior: 23 },
    education: { no_degree: 11, berufsausbildung: 32, abitur: 23, hochschulabschluss: 34 },
    income: { low: 28, middle: 48, high: 24 },
    urbanization: { urban: 100, suburban: 0, rural: 0 },
  },
  BB: {
    ethnicity: {
      german: 95,
      turkish_russian_diaspora: 2,
      mena: 1,
      eu_southern_eastern: 1,
      other: 1,
    },
    age: { young: 13, mid: 18, mature: 38, senior: 31 },
    education: { no_degree: 11, berufsausbildung: 55, abitur: 16, hochschulabschluss: 18 },
    income: { low: 28, middle: 55, high: 17 },
    urbanization: { urban: 22, suburban: 28, rural: 50 },
  },
  MV: {
    ethnicity: {
      german: 96,
      turkish_russian_diaspora: 2,
      mena: 1,
      eu_southern_eastern: 0,
      other: 1,
    },
    age: { young: 13, mid: 19, mature: 37, senior: 31 },
    education: { no_degree: 11, berufsausbildung: 57, abitur: 14, hochschulabschluss: 18 },
    income: { low: 33, middle: 52, high: 15 },
    urbanization: { urban: 18, suburban: 22, rural: 60 },
  },
  SN: {
    ethnicity: {
      german: 95,
      turkish_russian_diaspora: 2,
      mena: 1,
      eu_southern_eastern: 1,
      other: 1,
    },
    age: { young: 13, mid: 20, mature: 38, senior: 29 },
    education: { no_degree: 10, berufsausbildung: 52, abitur: 17, hochschulabschluss: 21 },
    income: { low: 28, middle: 55, high: 17 },
    urbanization: { urban: 38, suburban: 30, rural: 32 },
  },
  ST: {
    ethnicity: {
      german: 96,
      turkish_russian_diaspora: 2,
      mena: 1,
      eu_southern_eastern: 0,
      other: 1,
    },
    age: { young: 12, mid: 18, mature: 38, senior: 32 },
    education: { no_degree: 12, berufsausbildung: 58, abitur: 14, hochschulabschluss: 16 },
    income: { low: 31, middle: 54, high: 15 },
    urbanization: { urban: 30, suburban: 28, rural: 42 },
  },
  TH: {
    ethnicity: {
      german: 95,
      turkish_russian_diaspora: 2,
      mena: 1,
      eu_southern_eastern: 1,
      other: 1,
    },
    age: { young: 12, mid: 19, mature: 38, senior: 31 },
    education: { no_degree: 11, berufsausbildung: 55, abitur: 16, hochschulabschluss: 18 },
    income: { low: 29, middle: 54, high: 17 },
    urbanization: { urban: 25, suburban: 28, rural: 47 },
  },
};
