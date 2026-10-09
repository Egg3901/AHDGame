import type { OperatingSectorType } from "@/lib/constants/corporations";
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

export const RU_UNION_NAMES_MODERN: Partial<Record<OperatingSectorType, string>> = {
  manufacturing: "Federation of Independent Trade Unions of Russia",
  manufacturing_vehicles: "Federation of Independent Trade Unions of Russia",
  extraction: "Russian Independent Coal Employees' Union",
  energy: "Trade Union of Russian Fuel and Energy Sector Workers",
  construction: "Building Workers' Union of Russia",
  agriculture: "Agro-Industrial Workers' Union of Russia",
  healthcare: "Trade Union of Health Workers of Russia",
  retail: "Trade Union of Workers of Trade and Public Catering",
  logistics: "Russian Trade Union of Railwaymen and Transport Builders",
  media: "Interregional Trade Union of Media Workers",
  chemical_industries: "Federation of Independent Trade Unions of Russia",
  technology: "Federation of Independent Trade Unions of Russia",
  financial: "Trade Union of Workers of the Banking Sector",
  telecommunications: "Federation of Independent Trade Unions of Russia",
  media_entertainment: "Interregional Trade Union of Culture Workers",
  defense: "Federation of Independent Trade Unions of Russia",
  real_estate: "Building Workers' Union of Russia",
};

export const RU_UNION_NAMES_1991: Partial<Record<OperatingSectorType, string>> = uniform(
  "General Confederation of Trade Unions"
);

export const RU_UNION_NAMES_1979: Partial<Record<OperatingSectorType, string>> = uniform(
  "All-Union Central Council of Trade Unions"
);
