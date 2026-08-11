import type { CountryId } from "@/lib/constants/countries";

export interface CensusLabelSet {
  cardTitles: {
    ethnicity: string;
    age: string;
    education: string;
    income: string;
    urbanization: string;
  };
  ethnicity: Record<string, string>;
  age: Record<string, string>;
  education: Record<string, string>;
  income: Record<string, string>;
  urbanization: Record<string, string>;
}

const AGE_LABELS = {
  young: "Young (18-29)",
  mid: "Mid (30-44)",
  mature: "Mature (45-64)",
  senior: "Senior (65+)",
} as const;

const INCOME_TIERS = {
  low: "Lower income",
  middle: "Middle income",
  high: "Upper income",
} as const;

const URBAN_3 = { urban: "Urban", suburban: "Suburban / town", rural: "Rural" } as const;

/**
 * Per-country display labels for the archetype-style Layer-1 census cards.
 * US is intentionally absent — it uses its own dedicated branch + labels
 * (race / education / wealth / age / ideology) in the tab component.
 *
 * Income uses era-neutral tiers (Lower/Middle/Upper) because thresholds drift
 * between the 1991 and 2019 presets.
 */
// Shared by the UK and the seceded nations (SCO/WAL), which reuse the UK census
// categories and group keys.
const UK_CENSUS_LABELS: CensusLabelSet = {
  cardTitles: {
    ethnicity: "Ethnicity",
    age: "Age Distribution",
    education: "Education (Highest)",
    income: "Household Income",
    urbanization: "Urbanization",
  },
  ethnicity: {
    white_british: "White British / Irish",
    asian_british: "Asian British",
    black_british: "Black British",
    mixed: "Mixed",
    other: "Other",
  },
  age: { ...AGE_LABELS },
  education: {
    no_qualifications: "No qualifications",
    gcse_equivalent: "GCSE / Level 2",
    a_level_equivalent: "A-Level / Level 3",
    degree_plus: "Degree or higher",
  },
  income: { ...INCOME_TIERS },
  urbanization: {
    urban: "Urban conurbation",
    suburban: "Suburban / town",
    rural: "Rural / village",
  },
};

export const REGION_CENSUS_LABELS: Partial<Record<CountryId, CensusLabelSet>> = {
  UK: UK_CENSUS_LABELS,
  SCO: UK_CENSUS_LABELS,
  WAL: UK_CENSUS_LABELS,
  JP: {
    cardTitles: {
      ethnicity: "Ethnicity",
      age: "Age Distribution",
      education: "Education Level",
      income: "Household Income",
      urbanization: "Urbanization",
    },
    ethnicity: {
      japanese: "Japanese",
      chinese: "Chinese",
      korean: "Korean",
      southeast_asian: "Southeast Asian",
      other_foreign: "Other Foreign",
    },
    age: { ...AGE_LABELS },
    education: {
      high_school: "High School",
      vocational: "Vocational College",
      university: "University",
      graduate: "Graduate",
    },
    income: { ...INCOME_TIERS },
    urbanization: { urban: "Urban / city", suburban: "Suburban / town", rural: "Rural / village" },
  },
  DE: {
    cardTitles: {
      ethnicity: "Ethnicity / Background",
      age: "Age Distribution",
      education: "Education (Highest)",
      income: "Household Income",
      urbanization: "Urbanization",
    },
    ethnicity: {
      german: "German (no migration background)",
      turkish_russian_diaspora: "Turkish / Russian-German",
      mena: "MENA",
      eu_southern_eastern: "EU Southern / Eastern",
      other: "Other",
    },
    age: { ...AGE_LABELS },
    education: {
      no_degree: "No / Hauptschule",
      berufsausbildung: "Vocational (Lehre)",
      abitur: "Abitur / Fachhochschulreife",
      hochschulabschluss: "University degree",
    },
    income: { ...INCOME_TIERS },
    urbanization: { ...URBAN_3 },
  },
  IE: {
    cardTitles: {
      ethnicity: "Ethnicity / Background",
      age: "Age Distribution",
      education: "Education (Highest)",
      income: "Household Income",
      urbanization: "Urbanization",
    },
    ethnicity: {
      irish: "Irish",
      uk_british: "UK / British",
      eu_other: "Other EU",
      rest_of_world: "Rest of world",
    },
    age: { ...AGE_LABELS },
    education: {
      primary_or_less: "Primary or less",
      leaving_cert: "Leaving Certificate",
      post_secondary: "Post-secondary / PLC",
      third_level: "Third-level degree",
    },
    income: { ...INCOME_TIERS },
    urbanization: { urban: "City / urban", suburban: "Town", rural: "Rural" },
  },
  CN: {
    cardTitles: {
      ethnicity: "Ethnicity",
      age: "Age Distribution",
      education: "Education (Highest)",
      income: "Household Income",
      urbanization: "Urbanization",
    },
    ethnicity: {
      han: "Han",
      zhuang: "Zhuang",
      hui: "Hui",
      uyghur: "Uyghur",
      tibetan: "Tibetan",
      other_minority: "Other minority",
    },
    age: { ...AGE_LABELS },
    education: {
      primary_or_below: "Primary or below",
      secondary: "Secondary",
      vocational: "Vocational",
      university: "University",
    },
    income: { ...INCOME_TIERS },
    urbanization: { urban: "Urban", suburban: "County town", rural: "Rural" },
  },
  BR: {
    cardTitles: {
      ethnicity: "Race / Color (Cor/Raça)",
      age: "Age Distribution",
      education: "Education (Highest)",
      income: "Household Income",
      urbanization: "Urbanization",
    },
    ethnicity: {
      branco: "Branco (White)",
      pardo: "Pardo (Mixed)",
      preto: "Preto (Black)",
      amarelo: "Amarelo (Asian)",
      indigena: "Indígena",
    },
    age: { ...AGE_LABELS },
    education: {
      fundamental: "Fundamental",
      medio: "Ensino Médio",
      superior: "Ensino Superior",
    },
    income: { ...INCOME_TIERS },
    urbanization: { urban: "Urban", suburban: "Peri-urban", rural: "Rural" },
  },
};
