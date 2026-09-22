import type { CorporationType } from "@/lib/constants/corporations";

/**
 * IT's trade-union names, by era.
 *
 * Moved out of `src/lib/seeds/reference/unionNames.ts`, which now forwards to
 * this. Values unchanged.
 *
 * ⚠️ EACH OLDER ERA SPREADS THIS COUNTRY'S NEWER ONE, so the exports below
 * are ordered newest first and a spread only ever reaches backwards in this
 * file. The registry's own era chain -- an era map spreading the whole previous
 * map -- is a separate thing and stays there.
 */

export const IT_UNION_NAMES_MODERN: Partial<Record<CorporationType, string>> = {
  manufacturing: "FIOM-CGIL",
  automobiles: "FIOM-CGIL",
  chemical_industries: "FILCTEM-CGIL",
  construction: "FILLEA-CGIL",
  energy: "FLAEI-CISL",
  extraction: "FILCTEM-CGIL",
  healthcare: "FP-CGIL",
  retail: "Filcams-CGIL",
  media_entertainment: "SLC-CGIL",
  logistics: "FILT-CGIL",
  technology: "FIOM-CGIL",
  financial: "FISAC-CGIL",
  telecommunications: "SLC-CGIL",
  defense: "FIOM-CGIL",
  agriculture: "FLAI-CGIL",
  real_estate: "FILLEA-CGIL",
};

export const IT_UNION_NAMES_2007: Partial<Record<CorporationType, string>> = {
  ...IT_UNION_NAMES_MODERN,
  chemical_industries: "FILCEM-CGIL",
  extraction: "FILCEM-CGIL",
};

export const IT_UNION_NAMES_1999: Partial<Record<CorporationType, string>> = {
  ...IT_UNION_NAMES_2007,
  chemical_industries: "FILCEA-CGIL",
  extraction: "FILCEA-CGIL",
};

export const IT_UNION_NAMES_1991: Partial<Record<CorporationType, string>> = {
  manufacturing: "FIOM-CGIL",
  automobiles: "FIOM-CGIL",
  technology: "FIOM-CGIL",
  defense: "FIOM-CGIL",
  chemical_industries: "FILCEA-CGIL",
  extraction: "FILCEA-CGIL",
  construction: "FILLEA-CGIL",
  real_estate: "FILLEA-CGIL",
  energy: "FLAEI-CISL",
  healthcare: "FP-CGIL",
  retail: "Filcams-CGIL",
  media_entertainment: "FNSI",
  logistics: "FILT-CGIL",
  financial: "FISAC-CGIL",
  telecommunications: "FILPT-CGIL",
  agriculture: "FLAI-CGIL",
};

export const IT_UNION_NAMES_1979: Partial<Record<CorporationType, string>> = {
  manufacturing: "FIOM-CGIL",
  automobiles: "FIOM-CGIL",
  technology: "FIOM-CGIL",
  defense: "FIOM-CGIL",
  chemical_industries: "FILCEA-CGIL",
  extraction: "FILCEA-CGIL",
  construction: "FILLEA-CGIL",
  real_estate: "FILLEA-CGIL",
  energy: "FLAEI-CISL",
  retail: "Filcams-CGIL",
  media_entertainment: "FNSI",
  telecommunications: "FILPT-CGIL",
  agriculture: "Federbraccianti-CGIL",
};
