import type { CorporationType } from "@/lib/constants/corporations";

/**
 * US's trade-union names, by era.
 *
 * Moved out of `src/lib/seeds/reference/unionNames.ts`, which now forwards to
 * this. Values unchanged.
 *
 * ⚠️ EACH OLDER ERA SPREADS THIS COUNTRY'S NEWER ONE, so the exports below
 * are ordered newest first and a spread only ever reaches backwards in this
 * file. The registry's own era chain -- an era map spreading the whole previous
 * map -- is a separate thing and stays there.
 */

export const US_UNION_NAMES_MODERN: Partial<Record<CorporationType, string>> = {
  manufacturing: "United Steelworkers",
  automobiles: "United Auto Workers",
  extraction: "United Mine Workers of America",
  energy: "Utility Workers Union of America",
  construction: "United Brotherhood of Carpenters and Joiners",
  agriculture: "United Farm Workers",
  healthcare: "National Nurses United",
  retail: "United Food and Commercial Workers",
  logistics: "International Brotherhood of Teamsters",
  media: "NewsGuild-CWA",
  defense: "International Association of Machinists and Aerospace Workers",
  entertainment: "SAG-AFTRA",
  telecommunications: "Communications Workers of America",
  chemical_industries: "United Steelworkers",
  technology: "Communications Workers of America",
};

export const US_UNION_NAMES_2007: Partial<Record<CorporationType, string>> = {
  ...US_UNION_NAMES_MODERN,
  healthcare: "Service Employees International Union",
  media: "The Newspaper Guild",
  entertainment: "Screen Actors Guild",
};

export const US_UNION_NAMES_1991: Partial<Record<CorporationType, string>> = {
  ...US_UNION_NAMES_MODERN,
  manufacturing: "United Steelworkers of America",
  chemical_industries: "Oil, Chemical and Atomic Workers Union",
  media: "The Newspaper Guild",
  healthcare: "Service Employees International Union",
  technology: "International Brotherhood of Electrical Workers",
  entertainment: "Screen Actors Guild",
};

export const US_UNION_NAMES_1979: Partial<Record<CorporationType, string>> = {
  ...US_UNION_NAMES_1991,
  retail: "Retail Clerks International Association",
};

export const US_UNION_NAMES_1953: Partial<Record<CorporationType, string>> = {
  manufacturing: "United Steelworkers of America",
  automobiles: "United Auto Workers",
  extraction: "United Mine Workers of America",
  energy: "Utility Workers Union of America",
  construction: "United Brotherhood of Carpenters and Joiners",
  logistics: "International Brotherhood of Teamsters",
  media: "American Newspaper Guild",
  defense: "International Association of Machinists",
  telecommunications: "Communications Workers of America",
  chemical_industries: "Oil Workers International Union",
  entertainment: "Screen Actors Guild",
  retail: "Retail Clerks International Association",
};
