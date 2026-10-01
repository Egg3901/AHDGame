import type { CorporationType } from "@/lib/constants/corporations";

/**
 * UK's trade-union names, by era.
 *
 * Moved out of `src/lib/seeds/reference/unionNames.ts`, which now forwards to
 * this. Values unchanged.
 *
 * ⚠️ EACH OLDER ERA SPREADS THIS COUNTRY'S NEWER ONE, so the exports below
 * are ordered newest first and a spread only ever reaches backwards in this
 * file. The registry's own era chain -- an era map spreading the whole previous
 * map -- is a separate thing and stays there.
 */

export const UK_UNION_NAMES_MODERN: Partial<Record<CorporationType, string>> = {
  manufacturing: "Unite the Union",
  automobiles: "Unite the Union",
  extraction: "National Union of Mineworkers",
  energy: "GMB",
  construction: "Unite the Union",
  agriculture: "Unite the Union",
  healthcare: "UNISON",
  retail: "Usdaw",
  logistics: "Unite the Union",
  media: "National Union of Journalists",
  defense: "Unite the Union",
  entertainment: "BECTU",
  telecommunications: "Communication Workers Union",
  chemical_industries: "Unite the Union",
  technology: "Prospect",
  financial: "Unite the Union",
  real_estate: "Unite the Union",
};

export const UK_UNION_NAMES_1999: Partial<Record<CorporationType, string>> = {
  manufacturing: "Amalgamated Engineering and Electrical Union",
  automobiles: "Amalgamated Engineering and Electrical Union",
  defense: "Amalgamated Engineering and Electrical Union",
  extraction: "National Union of Mineworkers",
  energy: "GMB",
  chemical_industries: "GMB",
  construction: "Union of Construction, Allied Trades and Technicians",
  agriculture: "Transport and General Workers' Union",
  healthcare: "UNISON",
  retail: "Usdaw",
  logistics: "Transport and General Workers' Union",
  media: "National Union of Journalists",
  entertainment: "BECTU",
  telecommunications: "Communication Workers Union",
  technology: "Manufacturing, Science and Finance",
  financial: "Banking, Insurance and Finance Union",
  real_estate: "Union of Construction, Allied Trades and Technicians",
};

export const UK_UNION_NAMES_1991: Partial<Record<CorporationType, string>> = {
  ...UK_UNION_NAMES_1999,
  manufacturing: "Amalgamated Engineering Union",
  automobiles: "Amalgamated Engineering Union",
  defense: "Amalgamated Engineering Union",
  healthcare: "COHSE",
  telecommunications: "National Communications Union",
};

export const UK_UNION_NAMES_1979: Partial<Record<CorporationType, string>> = {
  manufacturing: "Amalgamated Union of Engineering Workers",
  automobiles: "Amalgamated Union of Engineering Workers",
  defense: "Amalgamated Union of Engineering Workers",
  extraction: "National Union of Mineworkers",
  energy: "General and Municipal Workers' Union",
  chemical_industries: "General and Municipal Workers' Union",
  construction: "Union of Construction, Allied Trades and Technicians",
  agriculture: "National Union of Agricultural and Allied Workers",
  healthcare: "Confederation of Health Service Employees",
  retail: "Union of Shop, Distributive and Allied Workers",
  logistics: "Transport and General Workers' Union",
  media: "National Union of Journalists",
  entertainment: "Association of Cinematograph, Television and Allied Technicians",
  telecommunications: "Union of Post Office Workers",
  technology: "Association of Scientific, Technical and Managerial Staffs",
  financial: "National Union of Bank Employees",
  real_estate: "Union of Construction, Allied Trades and Technicians",
};

export const UK_UNION_NAMES_1953: Partial<Record<CorporationType, string>> = {
  manufacturing: "Amalgamated Engineering Union",
  automobiles: "Amalgamated Engineering Union",
  extraction: "National Union of Mineworkers",
  energy: "Electrical Trades Union",
  construction: "National Federation of Building Trade Operatives",
  healthcare: "Confederation of Health Service Employees",
  retail: "Union of Shop, Distributive and Allied Workers",
  logistics: "National Union of Railwaymen",
  media: "National Union of Journalists",
  telecommunications: "Union of Post Office Workers",
  chemical_industries: "National Union of General and Municipal Workers",
  technology: "Amalgamated Engineering Union",
  financial: "National Union of Bank Employees",
  entertainment: "Association of Cine-Technicians",
  defense: "Amalgamated Engineering Union",
  agriculture: "National Union of Agricultural Workers",
  real_estate: "National Federation of Building Trade Operatives",
};
