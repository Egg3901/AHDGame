import type { CorporationType } from "@/lib/constants/corporations";
import { uniform } from "@/lib/seeds/reference/uniformUnionName";

/**
 * Japan's sector-to-union names, by era.
 *
 * Moved out of `src/lib/seeds/reference/unionNames.ts`, which now forwards each
 * era map to the const below. Values unchanged.
 *
 * ⚠ THE ERA MAPS ARE CUMULATIVE, BUT ONLY DOWNWARD FROM MODERN, AND THE
 * SPREAD IS SHALLOW AT THE COUNTRY LEVEL. `NAMES_2007` is `{ ...NAMES_MODERN,
 * JP: ... }`: naming JP at all replaces the whole modern JP map, it does not
 * merge into it. That is why 2007 and 1999 respread the map they descend from
 * here -- drop that spread and every sector the era does not restate silently
 * loses its union rather than inheriting one.
 *
 * 1991, 1979 and 1953 do NOT respread, deliberately: each is a different labour
 * settlement (Rengo was only founded in 1989, and 1953 is the single-federation
 * Sohyo era), so they are authored whole. Sectors they omit fall back to
 * `genericUnionName` at lookup, which is preferred over inventing a union.
 */

export const JP_UNION_NAMES_MODERN: Partial<Record<CorporationType, string>> = {
  manufacturing: "Japanese Trade Union Confederation",
  automobiles: "Confederation of Japan Automobile Workers' Unions",
  chemical_industries: "UA Zensen",
  construction: "National Federation of Construction Workers' Unions",
  energy: "Japanese Federation of Electric Wire and Electric Power Workers' Unions",
  extraction: "Japan Mining Industry Workers' Union",
  healthcare: "Japan Federation of Medical Workers' Unions",
  retail: "UA Zensen",
  media: "UA Zensen",
  logistics: "All Japan Seamen's Union",
  technology: "UA Zensen",
  financial: "National Federation of Finance Industry Workers' Unions",
  telecommunications: "UA Zensen",
  entertainment: "UA Zensen",
  defense: "Japan Federation of Aviation Industry Workers' Unions",
  agriculture: "UA Zensen",
  real_estate: "UA Zensen",
};

export const JP_UNION_NAMES_2007: Partial<Record<CorporationType, string>> = {
  ...JP_UNION_NAMES_MODERN,
  chemical_industries: "UI Zensen",
  retail: "UI Zensen",
  media: "UI Zensen",
  technology: "UI Zensen",
  telecommunications: "UI Zensen",
  entertainment: "UI Zensen",
  agriculture: "UI Zensen",
  real_estate: "UI Zensen",
};

export const JP_UNION_NAMES_1999: Partial<Record<CorporationType, string>> = {
  ...JP_UNION_NAMES_2007,
  chemical_industries: "Zensen Dōmei",
  retail: "Zensen Dōmei",
  media: "Zensen Dōmei",
  technology: "Zensen Dōmei",
  telecommunications: "Zensen Dōmei",
  entertainment: "Zensen Dōmei",
  agriculture: "Zensen Dōmei",
  real_estate: "Zensen Dōmei",
};

export const JP_UNION_NAMES_1991: Partial<Record<CorporationType, string>> = {
  manufacturing: "Japanese Trade Union Confederation",
  automobiles: "Confederation of Japan Automobile Workers' Unions",
  chemical_industries: "Japanese Federation of Synthetic Chemistry Workers' Unions",
  construction: "National Federation of Construction Workers' Unions",
  // Attribution to a single-era energy federation is uncertain; this is the
  // long-standing electric power workers' federation label.
  energy: "Japanese Federation of Electric Wire and Electric Power Workers' Unions",
  extraction: "Japan Coal Miners' Union",
  healthcare: "Japan Federation of Medical Workers' Unions",
  retail: "Zensen Dōmei",
  media: "Japan Federation of Publishing Workers' Unions",
  logistics: "All Japan Seamen's Union",
  technology: "Japanese Federation of Electrical Machine Workers' Unions",
  financial: "National Federation of Finance Industry Workers' Unions",
  telecommunications: "Japan Telecommunications Workers' Union",
};

export const JP_UNION_NAMES_1979: Partial<Record<CorporationType, string>> = {
  manufacturing: "General Council of Trade Unions of Japan",
  automobiles: "Confederation of Japan Automobile Workers' Unions",
  chemical_industries: "Japanese Federation of Synthetic Chemistry Workers' Unions",
  construction: "National Federation of Construction Workers' Unions",
  energy: "Japanese Federation of Electric Wire and Electric Power Workers' Unions",
  extraction: "Japan Coal Miners' Union",
  healthcare: "Japan Federation of Medical Workers' Unions",
  retail: "Zensen Dōmei",
  media: "Japan Federation of Publishing Workers' Unions",
  logistics: "All Japan Seamen's Union",
  technology: "Japanese Federation of Electrical Machine Workers' Unions",
  financial: "National Federation of Finance Industry Workers' Unions",
  telecommunications: "Japan Telecommunications Workers' Union",
};

export const JP_UNION_NAMES_1953: Partial<Record<CorporationType, string>> = {
  ...uniform("General Council of Trade Unions of Japan"),
  automobiles: "All Japan Automobile Industry Workers' Union",
  telecommunications: "Japan Telecommunications Workers' Union",
  logistics: "All Japan Seamen's Union",
  extraction: "Japan Coal Miners' Union",
};
