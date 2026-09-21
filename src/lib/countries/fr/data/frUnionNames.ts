import type { CorporationType } from "@/lib/constants/corporations";

/**
 * FR's trade-union names, by era.
 *
 * Moved out of `src/lib/seeds/reference/unionNames.ts`, which now forwards to
 * this. Values unchanged.
 *
 * ⚠️ EACH OLDER ERA SPREADS THIS COUNTRY'S NEWER ONE, so the exports below
 * are ordered newest first and a spread only ever reaches backwards in this
 * file. The registry's own era chain -- an era map spreading the whole previous
 * map -- is a separate thing and stays there.
 */

export const FR_UNION_NAMES_MODERN: Partial<Record<CorporationType, string>> = {
  manufacturing: "CGT Metalworkers' Federation",
  automobiles: "CGT Metalworkers' Federation",
  chemical_industries: "CGT Chemical Industries Federation",
  construction: "CGT Building and Wood Federation",
  energy: "CGT Energy Federation",
  extraction: "CGT Mines Federation",
  healthcare: "CGT Health Federation",
  retail: "CGT Trade and Services Federation",
  media_entertainment: "CGT Culture and Media Federation",
  logistics: "CGT Transport Federation",
  technology: "CGT Metalworkers' Federation",
  financial: "CGT Bank and Insurance Federation",
  telecommunications: "CGT Post and Telecommunications Federation",
  defense: "CGT Metalworkers' Federation",
  agriculture: "CGT Agricultural Workers' Federation",
  real_estate: "CGT Building and Wood Federation",
};
