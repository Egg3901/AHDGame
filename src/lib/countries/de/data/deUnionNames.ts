import type { CorporationType } from "@/lib/constants/corporations";

/**
 * DE's trade-union names, by era.
 *
 * Moved out of `src/lib/seeds/reference/unionNames.ts`, which now forwards to
 * this. Values unchanged.
 *
 * ⚠️ EACH OLDER ERA SPREADS THIS COUNTRY'S NEWER ONE, so the exports below
 * are ordered newest first and a spread only ever reaches backwards in this
 * file. The registry's own era chain -- an era map spreading the whole previous
 * map -- is a separate thing and stays there.
 */

export const DE_UNION_NAMES_MODERN: Partial<Record<CorporationType, string>> = {
  manufacturing: "IG Metall",
  automobiles: "IG Metall",
  chemical_industries: "IG BCE",
  construction: "IG BAU",
  energy: "IG BCE",
  extraction: "IG BCE",
  healthcare: "ver.di",
  retail: "ver.di",
  media_entertainment: "ver.di",
  logistics: "ver.di",
  technology: "IG Metall",
  financial: "ver.di",
  telecommunications: "ver.di",
  defense: "IG Metall",
  agriculture: "IG BAU",
  real_estate: "IG BAU",
};

export const DE_UNION_NAMES_1999: Partial<Record<CorporationType, string>> = {
  ...DE_UNION_NAMES_MODERN,
  healthcare: "ÖTV",
  logistics: "ÖTV",
  retail: "Gewerkschaft Handel, Banken und Versicherungen",
  financial: "Gewerkschaft Handel, Banken und Versicherungen",
  media_entertainment: "IG Medien",
  telecommunications: "Deutsche Postgewerkschaft",
};

export const DE_UNION_NAMES_1991: Partial<Record<CorporationType, string>> = {
  ...DE_UNION_NAMES_1999,
  chemical_industries: "IG Chemie-Papier-Keramik",
  construction: "IG Bau-Steine-Erden",
  real_estate: "IG Bau-Steine-Erden",
  energy: "IG Bergbau und Energie",
  extraction: "IG Bergbau und Energie",
  agriculture: "Gewerkschaft Gartenbau, Land- und Forstwirtschaft",
};

export const DE_UNION_NAMES_1979: Partial<Record<CorporationType, string>> = {
  ...DE_UNION_NAMES_1991,
  media_entertainment: "Deutsche Angestellten-Gewerkschaft",
};

export const DE_UNION_NAMES_1953: Partial<Record<CorporationType, string>> = {
  manufacturing: "IG Metall",
  automobiles: "IG Metall",
  chemical_industries: "IG Chemie-Papier-Keramik",
  construction: "IG Bau-Steine-Erden",
  energy: "IG Bergbau",
  extraction: "IG Bergbau",
  healthcare: "Gewerkschaft Öffentliche Dienste, Transport und Verkehr",
  retail: "Gewerkschaft Handel, Banken und Versicherungen",
  media_entertainment: "Deutsche Angestellten-Gewerkschaft",
  logistics: "Gewerkschaft der Eisenbahner Deutschlands",
  technology: "IG Metall",
  financial: "Gewerkschaft Handel, Banken und Versicherungen",
  telecommunications: "Deutsche Postgewerkschaft",
  defense: "IG Metall",
  agriculture: "Gewerkschaft Gartenbau, Land- und Forstwirtschaft",
  real_estate: "IG Bau-Steine-Erden",
};
