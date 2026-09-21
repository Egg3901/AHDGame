import type { CorporationType } from "@/lib/constants/corporations";
import { uniform } from "@/lib/seeds/reference/uniformUnionName";

/**
 * NG's trade-union names, by era.
 *
 * Moved out of `src/lib/seeds/reference/unionNames.ts`, which now forwards to
 * this. Values unchanged.
 *
 * ⚠️ EACH OLDER ERA SPREADS THIS COUNTRY'S NEWER ONE, so the exports below
 * are ordered newest first and a spread only ever reaches backwards in this
 * file. The registry's own era chain -- an era map spreading the whole previous
 * map -- is a separate thing and stays there.
 */

export const NG_UNION_NAMES_MODERN: Partial<Record<CorporationType, string>> = {
  manufacturing: "Nigeria Labour Congress",
  extraction: "Nigeria Union of Petroleum and Natural Gas Workers",
  energy: "Nigeria Union of Petroleum and Natural Gas Workers",
  agriculture: "Nigeria Agricultural and Allied Workers' Union",
  healthcare: "Medical and Health Workers' Union of Nigeria",
  retail: "Nigeria Labour Congress",
  construction: "Nigeria Labour Congress",
  logistics: "National Union of Road Transport Workers",
  media_entertainment: "Nigeria Labour Congress",
  chemical_industries: "Nigeria Labour Congress",
  technology: "Nigeria Labour Congress",
  financial: "Association of Senior Staff of Banks, Insurance and Financial Institutions",
  telecommunications: "Private Telecommunications and Communications Senior Staff Association",
  defense: "Nigeria Labour Congress",
  real_estate: "Nigeria Labour Congress",
  automobiles: "Nigeria Labour Congress",
};

export const NG_UNION_NAMES_1979: Partial<Record<CorporationType, string>> = {
  ...NG_UNION_NAMES_MODERN,
  telecommunications: "Nigeria Labour Congress",
};

export const NG_UNION_NAMES_1953: Partial<Record<CorporationType, string>> = uniform(
  "All-Nigeria Trade Union Federation"
);
