import type { CountryId } from "@/lib/constants/countries";
import { JP_IDENTITY } from "@/lib/countries/jp/identity";
import { UK_IDENTITY } from "@/lib/countries/uk/identity";

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
/**
 * The United Kingdom's census labels, forwarded to its country folder.
 *
 * ⚠️ THE CONST FORWARDS, NOT JUST THE `UK:` KEY, BECAUSE THREE COUNTRIES SHARE
 * IT. Scotland and Wales reuse the UK label set -- `SCO` and `WAL` point at this
 * same value. Repointing only `UK:` at the folder would have left the seceded
 * nations reading the old literal, and the two would have drifted the first time
 * anyone edited a label. One definition, three keys.
 */
const UK_CENSUS_LABELS = UK_IDENTITY.regionCensusLabels;

export const REGION_CENSUS_LABELS: Partial<Record<CountryId, CensusLabelSet>> = {
  UK: UK_CENSUS_LABELS,
  SCO: UK_CENSUS_LABELS,
  WAL: UK_CENSUS_LABELS,
  JP: JP_IDENTITY.regionCensusLabels,
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
  DD: {
    cardTitles: {
      ethnicity: "Ethnicity",
      age: "Age Distribution",
      education: "Education (Highest)",
      income: "Household Income",
      urbanization: "Urbanization",
    },
    ethnicity: {
      german: "German",
      other: "Other",
    },
    age: { ...AGE_LABELS },
    education: {
      primary_or_below: "Primary or below",
      secondary: "Secondary",
      vocational: "Vocational",
      university: "University",
    },
    income: { ...INCOME_TIERS },
    urbanization: { ...URBAN_3 },
  },
};
