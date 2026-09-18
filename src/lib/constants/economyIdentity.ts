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
import { JP_IDENTITY } from "@/lib/countries/jp/identity";
import { US_IDENTITY } from "@/lib/countries/us/identity";
import { UK_IDENTITY } from "@/lib/countries/uk/identity";
import { DE_IDENTITY } from "@/lib/countries/de/identity";

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

export const ECONOMY_TEXT: Partial<Record<CountryId, Omit<EconomyIdentity, "accent">>> = {
  US: US_IDENTITY.economyText,
  CN: {
    glyph: "经",
    serif: "cjk",
    title: "国民经济展望",
    titleEn: "Economic Outlook",
    office: "国家统计局 · 国民经济核算司",
    officeEn: "National Accounts Office",
    registry: "People's Republic of China · National Accounts Registry",
  },
  UK: UK_IDENTITY.economyText,
  DE: DE_IDENTITY.economyText,
  JP: JP_IDENTITY.economyText,
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
