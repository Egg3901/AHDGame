/**
 * Per-country "National Accounts" identity overlay for the Economic Outlook
 * surface (`/country/[code]/economy`).
 *
 * Text only — the accent + gradient palettes are composed from the country's
 * statistics-office identity (`nationalStatsIdentity`) so the Economy, Metrics,
 * Budget, and NatCorp mastheads stay one color family with a single source of
 * brand truth. Identity values are intentionally not theme tokens: the masthead
 * is always dark, and consumers scope them as CSS custom properties on the
 * masthead container only.
 */
import type { CountryId } from "./countries";
import { getStatsIdentity, type StatsAccent } from "./nationalStatsIdentity";

export interface EconomyIdentity {
  /** Watermark / chop glyph (经 / US / …). */
  glyph: string;
  /** Seal font treatment. */
  serif: "cjk" | "mono";
  /** Page title (native). */
  title: string;
  /** English title, or null when the title is already English. */
  titleEn: string | null;
  /** Office line under the title (native). */
  office: string;
  /** English office name. */
  officeEn: string;
  /** Registry eyebrow line above the title. */
  registry: string;
  /** Accent + gradient palette (shared with the stats identity). */
  accent: StatsAccent;
}

const ECONOMY_TEXT: Partial<Record<CountryId, Omit<EconomyIdentity, "accent">>> = {
  US: {
    glyph: "US",
    serif: "mono",
    title: "Economic Outlook",
    titleEn: null,
    office: "Bureau of National Accounts",
    officeEn: "Bureau of National Accounts",
    registry: "United States · National Accounts Registry",
  },
  CN: {
    glyph: "经",
    serif: "cjk",
    title: "国民经济展望",
    titleEn: "Economic Outlook",
    office: "国家统计局 · 国民经济核算司",
    officeEn: "National Accounts Office",
    registry: "People's Republic of China · National Accounts Registry",
  },
  UK: {
    glyph: "UK",
    serif: "mono",
    title: "Economic Outlook",
    titleEn: null,
    office: "Office for National Statistics · Economic Accounts",
    officeEn: "Office for National Statistics · Economic Accounts",
    registry: "United Kingdom · National Accounts Registry",
  },
  DE: {
    glyph: "DE",
    serif: "mono",
    title: "Wirtschaftsausblick",
    titleEn: "Economic Outlook",
    office: "Statistisches Bundesamt · Volkswirtschaftliche Gesamtrechnungen",
    officeEn: "Federal Statistical Office · National Accounts",
    registry: "Federal Republic of Germany · National Accounts Registry",
  },
  JP: {
    glyph: "経",
    serif: "cjk",
    title: "経済展望",
    titleEn: "Economic Outlook",
    office: "内閣府 · 経済社会総合研究所",
    officeEn: "Cabinet Office · Economic and Social Research Institute",
    registry: "Japan · National Accounts Registry",
  },
  IE: {
    glyph: "ÉI",
    serif: "mono",
    title: "Ionchas Eacnamaíochta",
    titleEn: "Economic Outlook",
    office: "An Phríomh-Oifig Staidrimh · Cuntais Náisiúnta",
    officeEn: "Central Statistics Office · National Accounts",
    registry: "Ireland · National Accounts Registry",
  },
  BR: {
    glyph: "BR",
    serif: "mono",
    title: "Panorama Econômico",
    titleEn: "Economic Outlook",
    office: "IBGE · Contas Nacionais",
    officeEn: "IBGE · National Accounts",
    registry: "Federative Republic of Brazil · National Accounts Registry",
  },
  NG: {
    glyph: "NG",
    serif: "mono",
    title: "Economic Outlook",
    titleEn: null,
    office: "National Bureau of Statistics · National Accounts",
    officeEn: "National Bureau of Statistics · National Accounts",
    registry: "Federal Republic of Nigeria · National Accounts Registry",
  },
};

const DEFAULT_ECONOMY_TEXT: Omit<EconomyIdentity, "accent"> = {
  glyph: "EO",
  serif: "mono",
  title: "Economic Outlook",
  titleEn: null,
  office: "National Accounts Office",
  officeEn: "National Accounts Office",
  registry: "National Accounts Registry",
};

/** Resolve the economy identity for a country, with a neutral fallback. */
export function getEconomyIdentity(countryId: string): EconomyIdentity {
  const text = ECONOMY_TEXT[countryId as CountryId] ?? DEFAULT_ECONOMY_TEXT;
  // getStatsIdentity falls back to DEFAULT_STATS_IDENTITY's neutral palette
  // for countries without a bespoke stats identity (e.g. BR, NG).
  return { ...text, accent: getStatsIdentity(countryId).accent };
}
