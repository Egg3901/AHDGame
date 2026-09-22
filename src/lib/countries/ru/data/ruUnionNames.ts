import type { CorporationType } from "@/lib/constants/corporations";
import { uniform } from "@/lib/seeds/reference/uniformUnionName";

/**
 * RU's trade-union names, by era.
 *
 * Moved out of `src/lib/seeds/reference/unionNames.ts`, which now forwards to
 * this. Values unchanged.
 *
 * ⚠️ EACH OLDER ERA SPREADS THIS COUNTRY'S NEWER ONE, so the exports below
 * are ordered newest first and a spread only ever reaches backwards in this
 * file. The registry's own era chain -- an era map spreading the whole previous
 * map -- is a separate thing and stays there.
 */

export const RU_UNION_NAMES_MODERN: Partial<Record<CorporationType, string>> = {
  manufacturing: "Federation of Independent Trade Unions of Russia",
  automobiles: "Federation of Independent Trade Unions of Russia",
  extraction: "Russian Independent Coal Employees' Union",
  energy: "Trade Union of Russian Fuel and Energy Sector Workers",
  construction: "Building Workers' Union of Russia",
  agriculture: "Agro-Industrial Workers' Union of Russia",
  healthcare: "Trade Union of Health Workers of Russia",
  retail: "Trade Union of Workers of Trade and Public Catering",
  logistics: "Russian Trade Union of Railwaymen and Transport Builders",
  media_entertainment: "Interregional Trade Union of Culture Workers",
  chemical_industries: "Federation of Independent Trade Unions of Russia",
  technology: "Federation of Independent Trade Unions of Russia",
  financial: "Trade Union of Workers of the Banking Sector",
  telecommunications: "Federation of Independent Trade Unions of Russia",
  defense: "Federation of Independent Trade Unions of Russia",
  real_estate: "Building Workers' Union of Russia",
};

export const RU_UNION_NAMES_1991: Partial<Record<CorporationType, string>> = uniform(
  "General Confederation of Trade Unions"
);

export const RU_UNION_NAMES_1979: Partial<Record<CorporationType, string>> = uniform(
  "All-Union Central Council of Trade Unions"
);
