import type { OperatingSectorType } from "@/lib/constants/corporations";

/**
 * SE's trade-union names, by era.
 *
 * Moved out of `src/lib/seeds/reference/unionNames.ts`, which now forwards to
 * this. Values unchanged.
 *
 * ⚠️ EACH OLDER ERA SPREADS THIS COUNTRY'S NEWER ONE, so the exports below
 * are ordered newest first and a spread only ever reaches backwards in this
 * file. The registry's own era chain -- an era map spreading the whole previous
 * map -- is a separate thing and stays there.
 */

export const SE_UNION_NAMES_MODERN: Partial<Record<OperatingSectorType, string>> = {
  manufacturing: "IF Metall",
  manufacturing_vehicles: "IF Metall",
  chemical_industries: "IF Metall",
  construction: "Byggnads",
  energy: "Unionen",
  extraction: "IF Metall",
  healthcare: "Vårdförbundet",
  retail: "Handels",
  media: "Journalistförbundet",
  logistics: "Transport",
  technology: "Unionen",
  financial: "Finansförbundet",
  telecommunications: "Unionen",
  media_entertainment: "Unionen",
  defense: "IF Metall",
  agriculture: "Kommunal",
  real_estate: "Byggnads",
};

export const SE_UNION_NAMES_2007: Partial<Record<OperatingSectorType, string>> = {
  ...SE_UNION_NAMES_MODERN,
  energy: "Sif",
  technology: "Sif",
  telecommunications: "Sif",
  media_entertainment: "Sif",
};

export const SE_UNION_NAMES_1991: Partial<Record<OperatingSectorType, string>> = {
  ...SE_UNION_NAMES_MODERN,
  manufacturing: "Metall",
  manufacturing_vehicles: "Metall",
  chemical_industries: "Metall",
  extraction: "Metall",
  defense: "Metall",
  energy: "SIF",
  technology: "SIF",
  telecommunications: "SIF",
  media_entertainment: "SIF",
  healthcare: "Kommunal",
  financial: "Svenska Bankmannaförbundet",
  agriculture: "Svenska Lantarbetareförbundet",
};
