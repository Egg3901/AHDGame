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
  CN: {
    glyph: "统",
    serif: "cjk",
    office: "国家统计局",
    officeEn: "National Bureau of Statistics",
    title: "国家统计 (National Statistics)",
    titleEn: "National Statistics",
    registry: "People's Republic of China · National Bureau of Statistics",
    seal: "统计局 · NBS",
    accent: { stat: "#d8b25e", statSoft: "#e7cd91", g0: "#4a1212", g1: "#2a0e0e", g2: "#160a0e" },
  },
  US: {
    glyph: "US",
    serif: "mono",
    office: "Bureau of Economic Analysis",
    officeEn: "Bureau of Economic Analysis",
    title: "Federal Statistics",
    titleEn: null,
    registry: "United States · Bureau of Economic Analysis",
    seal: "U.S. BEA",
    accent: { stat: "#b9933f", statSoft: "#d9b970", g0: "#1b2747", g1: "#121b33", g2: "#0b0f1c" },
  },
  UK: {
    glyph: "ONS",
    serif: "mono",
    office: "Office for National Statistics",
    officeEn: "Office for National Statistics",
    title: "National Statistics",
    titleEn: null,
    registry: "United Kingdom · Office for National Statistics",
    seal: "UK ONS",
    accent: { stat: "#c9a24b", statSoft: "#e1c382", g0: "#16233f", g1: "#101a30", g2: "#0c1018" },
  },
  DE: {
    glyph: "DES",
    serif: "mono",
    office: "Statistisches Bundesamt",
    officeEn: "Federal Statistical Office",
    title: "Bundesstatistik (Federal Statistics)",
    titleEn: "Federal Statistics",
    registry: "Federal Republic of Germany · Statistisches Bundesamt",
    seal: "DESTATIS",
    accent: { stat: "#d4a244", statSoft: "#e8c884", g0: "#2a2218", g1: "#1a150d", g2: "#100c07" },
  },
  JP: {
    glyph: "統",
    serif: "cjk",
    office: "総務省統計局",
    officeEn: "Statistics Bureau of Japan",
    title: "国家統計 (National Statistics)",
    titleEn: "National Statistics",
    registry: "Japan · Statistics Bureau",
    seal: "統計局 · SBJ",
    accent: { stat: "#e6b85c", statSoft: "#f3d79a", g0: "#7a1d12", g1: "#3a0e0a", g2: "#1c0707" },
  },
  IE: {
    glyph: "CSO",
    serif: "mono",
    office: "An Phríomh-Oifig Staidrimh",
    officeEn: "Central Statistics Office",
    title: "Staidreamh Náisiúnta (National Statistics)",
    titleEn: "National Statistics",
    registry: "Ireland · Central Statistics Office",
    seal: "CSO · IE",
    accent: { stat: "#cba24b", statSoft: "#e4c886", g0: "#123022", g1: "#0d2017", g2: "#08130d" },
  },
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
