/**
 * Shared scaffolding for the per-country bucket labels.
 *
 * ⚠️ THIS MODULE EXISTS TO BREAK A CYCLE, and its contents are not arbitrary.
 * Each country's labels live in its own folder now, and `bucketLabelsByCountry`
 * imports them -- so the scaffolding those folders share cannot live in that
 * table without the folders importing back into it. It sits here instead, below
 * both.
 *
 * The English blocks are the terms shared by countries with no distinct native
 * vocabulary for a dimension (an age band is an age band); the German ones are
 * shared by the two German states. A country that says something different says
 * it in its own folder rather than editing these.
 */

export interface CountryBucketLabels {
  /** Dimension headers, e.g. `education` → "Bildung". */
  dims: Record<string, string>;
  /** `dim` → bucket key → label. */
  buckets: Record<string, Record<string, string>>;
}

export const AGE_EN = {
  young: "Under 30s",
  mid: "30s and 40s",
  mature: "50s and 60s",
  senior: "Over 65s",
};

export const INCOME_EN = { low: "Lower income", middle: "Middle income", high: "Higher income" };

export const URBAN_EN = { urban: "Cities", suburban: "Suburbs", rural: "Countryside" };

export const DIMS_EN = {
  ethnicity: "Background",
  age: "Age",
  education: "Education",
  income: "Income",
  urbanization: "Where they live",
};

export const AGE_DE = {
  young: "Unter 30",
  mid: "30 bis 49",
  mature: "50 bis 64",
  senior: "Über 65",
};

export const INCOME_DE = {
  low: "Geringes Einkommen",
  middle: "Mittleres Einkommen",
  high: "Hohes Einkommen",
};

export const DIMS_DE = {
  ethnicity: "Herkunft",
  age: "Alter",
  education: "Bildung",
  income: "Einkommen",
  urbanization: "Wohnort",
};
