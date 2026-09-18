/**
 * Per-country "National Statistics Office" visual identity for the metrics
 * surfaces (national page, regional tab, metric detail page).
 *
 * This carries ONLY what's genuinely new for the masthead — glyph, seal, office
 * names, title strings, and the accent/gradient palette. Region label, region
 * plural, and currency symbol are read from `COUNTRY_CONFIGS` /
 * `getCurrencyPrefix` at the call site and are NOT duplicated here.
 *
 * The accent + gradient values are identity (not theme) values: the masthead is
 * intentionally always dark, so consumers inject these as scoped CSS custom
 * properties on the masthead container only — never on the themed body.
 */
import type { CountryId } from "./countries";
import { JP_IDENTITY } from "@/lib/countries/jp/identity";
import { US_IDENTITY } from "@/lib/countries/us/identity";
import { UK_IDENTITY } from "@/lib/countries/uk/identity";
import { DE_IDENTITY } from "@/lib/countries/de/identity";
import { CN_IDENTITY } from "@/lib/countries/cn/identity";
import { IE_IDENTITY } from "@/lib/countries/ie/identity";

export interface StatsAccent {
  /** Accent gold/brass. */
  stat: string;
  /** Lighter accent (text on dark). */
  statSoft: string;
  /** Masthead gradient stop 0 (top-left). */
  g0: string;
  /** Masthead gradient stop 1 (mid). */
  g1: string;
  /** Masthead gradient stop 2 (bottom-right). */
  g2: string;
}

export interface StatsIdentity {
  /** Watermark glyph / monogram (统 / US / ONS …). */
  glyph: string;
  /** Seal font treatment. */
  serif: "cjk" | "mono";
  /** Native office name. */
  office: string;
  /** English office name. */
  officeEn: string;
  /** Page title (native + "(English)" where the native name isn't English). */
  title: string;
  /** English title, or null when the title is already English. */
  titleEn: string | null;
  /** Dossier registry line. */
  registry: string;
  /** Round-seal text. */
  seal: string;
  /** Accent + gradient palette. */
  accent: StatsAccent;
}

export const NATIONAL_STATS_IDENTITY: Partial<Record<CountryId, StatsIdentity>> = {
  CN: CN_IDENTITY.stats,
  US: US_IDENTITY.stats,
  UK: UK_IDENTITY.stats,
  DE: DE_IDENTITY.stats,
  JP: JP_IDENTITY.stats,
  IE: IE_IDENTITY.stats,
};

/** Neutral fallback for countries without a bespoke identity (e.g. BR, NG). */
export const DEFAULT_STATS_IDENTITY: StatsIdentity = {
  glyph: "NS",
  serif: "mono",
  office: "National Statistics Office",
  officeEn: "National Statistics Office",
  title: "National Statistics",
  titleEn: null,
  registry: "National Statistics Office",
  seal: "STATS",
  accent: { stat: "#c9a24b", statSoft: "#e1c382", g0: "#1d1d2a", g1: "#16161f", g2: "#0c0c12" },
};

/** Resolve the statistics-office identity for a country, with a neutral fallback. */
export function getStatsIdentity(countryId: string): StatsIdentity {
  return NATIONAL_STATS_IDENTITY[countryId as CountryId] ?? DEFAULT_STATS_IDENTITY;
}
