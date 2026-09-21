import type { CorporationType } from "@/lib/constants/corporations";

/**
 * IE's trade-union names, by era.
 *
 * Moved out of `src/lib/seeds/reference/unionNames.ts`, which now forwards to
 * this. Values unchanged.
 *
 * ⚠️ EACH OLDER ERA SPREADS THIS COUNTRY'S NEWER ONE, so the exports below
 * are ordered newest first and a spread only ever reaches backwards in this
 * file. The registry's own era chain -- an era map spreading the whole previous
 * map -- is a separate thing and stays there.
 */

export const IE_UNION_NAMES_MODERN: Partial<Record<CorporationType, string>> = {
  manufacturing: "SIPTU",
  automobiles: "SIPTU",
  healthcare: "INMO",
  retail: "Mandate",
  construction: "Connect Trade Union",
  energy: "SIPTU",
  logistics: "SIPTU",
  media_entertainment: "National Union of Journalists",
  financial: "Financial Services Union",
  technology: "SIPTU",
  telecommunications: "CWU Ireland",
};

export const IE_UNION_NAMES_1999: Partial<Record<CorporationType, string>> = {
  ...IE_UNION_NAMES_MODERN,
  healthcare: "Irish Nurses Organisation",
  financial: "Irish Bank Officials' Association",
  construction: "Technical Engineering and Electrical Union",
};

export const IE_UNION_NAMES_1991: Partial<Record<CorporationType, string>> = {
  manufacturing: "SIPTU",
  automobiles: "SIPTU",
  energy: "SIPTU",
  logistics: "SIPTU",
  technology: "SIPTU",
  healthcare: "Irish Nurses Organisation",
  retail: "Irish Distributive and Administrative Trade Union",
  media_entertainment: "National Union of Journalists",
  financial: "Irish Bank Officials' Association",
  telecommunications: "Communications Workers' Union",
};

export const IE_UNION_NAMES_1979: Partial<Record<CorporationType, string>> = {
  manufacturing: "Irish Transport and General Workers' Union",
  automobiles: "Irish Transport and General Workers' Union",
  energy: "Irish Transport and General Workers' Union",
  logistics: "Irish Transport and General Workers' Union",
  technology: "Irish Transport and General Workers' Union",
  healthcare: "Irish Nurses Organisation",
  retail: "Irish Distributive and Administrative Trade Union",
  media_entertainment: "National Union of Journalists",
  financial: "Irish Bank Officials' Association",
  telecommunications: "Post Office Workers' Union",
};

export const IE_UNION_NAMES_1953: Partial<Record<CorporationType, string>> = {
  ...IE_UNION_NAMES_1979,
  retail: "Irish Union of Distributive Workers and Clerks",
};
