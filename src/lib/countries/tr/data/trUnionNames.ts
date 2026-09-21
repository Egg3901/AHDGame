import type { CorporationType } from "@/lib/constants/corporations";
import { uniform } from "@/lib/seeds/reference/uniformUnionName";

/**
 * TR's trade-union names, by era.
 *
 * Moved out of `src/lib/seeds/reference/unionNames.ts`, which now forwards to
 * this. Values unchanged.
 *
 * ⚠️ EACH OLDER ERA SPREADS THIS COUNTRY'S NEWER ONE, so the exports below
 * are ordered newest first and a spread only ever reaches backwards in this
 * file. The registry's own era chain -- an era map spreading the whole previous
 * map -- is a separate thing and stays there.
 */

export const TR_UNION_NAMES_MODERN: Partial<Record<CorporationType, string>> = {
  manufacturing: "Türk Metal",
  automobiles: "Türk Metal",
  chemical_industries: "Petrol-İş",
  construction: "Yol-İş",
  energy: "Tes-İş",
  extraction: "Genel Maden-İş",
  healthcare: "Sağlık-Sen",
  retail: "Tez-Koop-İş",
  media_entertainment: "Basın-İş",
  logistics: "TÜMTİS",
  financial: "Bank-Sen",
  telecommunications: "Haber-İş",
  defense: "Türk Metal",
  agriculture: "Tarım-İş",
  real_estate: "Yol-İş",
};

export const TR_UNION_NAMES_1991: Partial<Record<CorporationType, string>> = {
  ...TR_UNION_NAMES_MODERN,
  // Sağlık-Sen dates from 1995; Sağlık-İş (Türk-İş, 1961) precedes it.
  healthcare: "Sağlık-İş",
};

export const TR_UNION_NAMES_1953: Partial<Record<CorporationType, string>> = {
  ...uniform("Türk-İş"),
  chemical_industries: "Petrol-İş",
  logistics: "TÜMTİS",
  extraction: "Genel Maden-İş",
};
