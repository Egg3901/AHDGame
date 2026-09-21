import type { CorporationType } from "@/lib/constants/corporations";

/**
 * BR's trade-union names, by era.
 *
 * Moved out of `src/lib/seeds/reference/unionNames.ts`, which now forwards to
 * this. Values unchanged.
 *
 * ⚠️ EACH OLDER ERA SPREADS THIS COUNTRY'S NEWER ONE, so the exports below
 * are ordered newest first and a spread only ever reaches backwards in this
 * file. The registry's own era chain -- an era map spreading the whole previous
 * map -- is a separate thing and stays there.
 */

export const BR_UNION_NAMES_MODERN: Partial<Record<CorporationType, string>> = {
  manufacturing: "CUT Metalworkers' Federation",
  automobiles: "CUT Metalworkers' Federation",
  extraction: "CUT Mining Federation",
  energy: "CUT Energy Federation",
  agriculture: "CONTAG",
  healthcare: "CUT Health Workers' Federation",
  retail: "CUT Commerce Federation",
  construction: "CUT Construction Federation",
  logistics: "CUT Transport Federation",
  media_entertainment: "CUT Culture Federation",
  chemical_industries: "CUT Chemical Workers' Federation",
  technology: "CUT Metalworkers' Federation",
  financial: "CUT Bank Workers' Federation",
  telecommunications: "CUT Communications Federation",
  defense: "CUT Metalworkers' Federation",
  real_estate: "CUT Construction Federation",
};

export const BR_UNION_NAMES_1979: Partial<Record<CorporationType, string>> = {
  manufacturing: "National Confederation of Industrial Workers",
  automobiles: "National Confederation of Industrial Workers",
  chemical_industries: "National Confederation of Industrial Workers",
  extraction: "National Confederation of Industrial Workers",
  energy: "National Confederation of Industrial Workers",
  technology: "National Confederation of Industrial Workers",
  defense: "National Confederation of Industrial Workers",
  retail: "National Confederation of Commerce Workers",
  logistics: "National Confederation of Land Transport Workers",
  agriculture: "CONTAG",
};

export const BR_UNION_NAMES_1953: Partial<Record<CorporationType, string>> = {
  manufacturing: "National Confederation of Industrial Workers",
  automobiles: "National Confederation of Industrial Workers",
  chemical_industries: "National Confederation of Industrial Workers",
  extraction: "National Confederation of Industrial Workers",
  energy: "National Confederation of Industrial Workers",
  technology: "National Confederation of Industrial Workers",
  defense: "National Confederation of Industrial Workers",
  retail: "National Confederation of Commerce Workers",
};
