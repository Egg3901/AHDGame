import type { CountryId } from "@/lib/constants/countries";
import { getNationalIdentity, type NationalIdentity } from "@/lib/constants/nationalIdentity";
import { JP_IDENTITY } from "@/lib/countries/jp/identity";
import { US_IDENTITY } from "@/lib/countries/us/identity";
import { UK_IDENTITY } from "@/lib/countries/uk/identity";
import { DE_IDENTITY } from "@/lib/countries/de/identity";
import { CN_IDENTITY } from "@/lib/countries/cn/identity";
import { IE_IDENTITY } from "@/lib/countries/ie/identity";
import { RU_IDENTITY } from "@/lib/countries/ru/identity";
import { DD_IDENTITY } from "@/lib/countries/dd/identity";

/**
 * Treasury / Finance-Ministry identity overlay for the National Budget surface.
 *
 * The corp `NATIONAL_IDENTITY` describes the *state enterprise* (CN glyph 国,
 * 经济部 / Economy Ministry). The budget page is the *finance ministry*, so it
 * needs its own text — CN glyph 财, 财政部 / Ministry of Finance, title 国家预算.
 *
 * **Brand colors are NOT duplicated:** `palette` / `accent` / `accentSoft` are
 * pulled from `getNationalIdentity(country)` so the budget and corp surfaces
 * stay color-consistent and there is one source of brand truth. Only the text
 * (glyph, titles, ministry/public seal) is overlaid here.
 *
 * Text values come from the Country Identity Kit in the National Budget design
 * bundle (`docs/superpowers/specs/2026-06-03-national-budget-design/`).
 */
export interface TreasuryIdentity {
  /** Seal-chop glyph — a single CJK character or a short serif monogram. */
  glyph: string;
  /** Whether the glyph renders in a CJK serif (`cjk`) or a serif monogram (`mono`). */
  serif: "cjk" | "mono";
  /** Budget page title (original language). */
  budgetTitle: string;
  /** English title, shown parenthetically when `budgetTitle` is non-English. */
  budgetTitleEn?: string;
  /** Official-view (finance-minister lens) seal label. */
  ministry: string;
  /** Public-view seal label. */
  publicSeal: string;
  /** Finance-ministry registry eyebrow line above the title. */
  registry: string;
  /** Ministry sub-line under the title (original language). */
  native: string;
  /** English ministry sub-line, shown parenthetically when `native` is non-English. */
  nativeEn?: string;
  /** Banner gradient stops (shared brand color, fixed per country). */
  palette: NationalIdentity["palette"];
  /** Accent line / seal stroke (shared brand color). */
  accent: string;
  /** Lighter accent for glyph fill / hairlines (shared brand color). */
  accentSoft: string;
}

/** Finance-ministry text overlay; brand colors are composed from NATIONAL_IDENTITY. */
export const TREASURY_TEXT: Record<
  CountryId,
  Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft">
> = {
  CN: CN_IDENTITY.treasuryText,
  US: US_IDENTITY.treasuryText,
  UK: UK_IDENTITY.treasuryText,
  DE: DE_IDENTITY.treasuryText,
  JP: JP_IDENTITY.treasuryText,
  IE: IE_IDENTITY.treasuryText,
  BR: {
    glyph: "BR",
    serif: "mono",
    budgetTitle: "Orçamento Nacional",
    budgetTitleEn: "National Budget",
    ministry: "TESOURO NACIONAL",
    publicSeal: "PÚBLICO · PUBLIC",
    registry: "Federative Republic of Brazil · National Treasury",
    native: "República Federativa do Brasil · Tesouro Nacional",
    nativeEn: "Federative Republic of Brazil · National Treasury",
  },
  NG: {
    glyph: "NG",
    serif: "mono",
    budgetTitle: "National Budget",
    ministry: "FEDERAL TREASURY",
    publicSeal: "PUBLIC RECORD",
    registry: "Federal Republic of Nigeria · Federal Treasury",
    native: "Federal Republic of Nigeria · Office of the Accountant-General",
  },
  HU: {
    glyph: "HU",
    serif: "mono",
    budgetTitle: "State Plan Budget",
    ministry: "MINISTRY OF FINANCE",
    publicSeal: "PUBLIC RECORD",
    registry: "Hungarian People's Republic · Ministry of Finance",
    native: "Magyar Népköztársaság · Pénzügyminisztérium",
  },
  PL: {
    glyph: "PL",
    serif: "mono",
    budgetTitle: "State Plan Budget",
    ministry: "MINISTRY OF FINANCE",
    publicSeal: "PUBLIC RECORD",
    registry: "Polish People's Republic · Ministry of Finance",
    native: "Polska Rzeczpospolita Ludowa · Ministerstwo Finansów",
  },
  RO: {
    glyph: "RO",
    serif: "mono",
    budgetTitle: "State Plan Budget",
    ministry: "MINISTRY OF FINANCE",
    publicSeal: "PUBLIC RECORD",
    registry: "Socialist Republic of Romania · Ministry of Finance",
    native: "Republica Socialistă România · Ministerul Finanțelor",
  },
  YU: {
    glyph: "YU",
    serif: "mono",
    budgetTitle: "Federal Budget",
    ministry: "FEDERAL SECRETARIAT FOR FINANCE",
    publicSeal: "PUBLIC RECORD",
    registry: "SFR Yugoslavia · Federal Secretariat for Finance",
    native: "SFR Jugoslavija · Savezni sekretarijat za finansije",
  },
  BG: {
    glyph: "BG",
    serif: "mono",
    budgetTitle: "State Plan Budget",
    ministry: "MINISTRY OF FINANCE",
    publicSeal: "PUBLIC RECORD",
    registry: "People's Republic of Bulgaria · Ministry of Finance",
    native: "Народна република България · Министерство на финансите",
  },
  BLR: {
    glyph: "BLR",
    serif: "mono",
    budgetTitle: "State Plan Budget",
    ministry: "MINISTRY OF FINANCE",
    publicSeal: "PUBLIC RECORD",
    registry: "Byelorussian SSR · Ministry of Finance",
    native: "Беларуская ССР · Міністэрства фінансаў",
  },
  UKR: {
    glyph: "UKR",
    serif: "mono",
    budgetTitle: "State Plan Budget",
    ministry: "MINISTRY OF FINANCE",
    publicSeal: "PUBLIC RECORD",
    registry: "Ukrainian SSR · Ministry of Finance",
    native: "Українська РСР · Міністерство фінансів",
  },
  CS: {
    glyph: "CS",
    serif: "mono",
    budgetTitle: "State Plan Budget",
    ministry: "FEDERAL MINISTRY OF FINANCE",
    publicSeal: "PUBLIC RECORD",
    registry: "Czechoslovak Socialist Republic · Federal Ministry of Finance",
    native: "Československá socialistická republika · Federální ministerstvo financí",
  },
  BAL: {
    glyph: "BAL",
    serif: "mono",
    budgetTitle: "State Plan Budget",
    ministry: "MINISTRY OF FINANCE",
    publicSeal: "PUBLIC RECORD",
    registry: "Baltic Soviet Republics · Ministries of Finance",
    native: "Baltijas PSR · Finanšu ministrijas",
  },
  RU: RU_IDENTITY.treasuryText,
  FR: {
    glyph: "RF",
    serif: "mono",
    budgetTitle: "State Budget",
    ministry: "MINISTRY OF ECONOMY AND FINANCE",
    publicSeal: "PUBLIC RECORD",
    registry: "French Republic · Ministry of Economy and Finance",
    native: "République française · Ministère de l'Économie et des Finances",
  },
  IT: {
    glyph: "RI",
    serif: "mono",
    budgetTitle: "State Budget",
    ministry: "MINISTRY OF THE TREASURY",
    publicSeal: "PUBLIC RECORD",
    registry: "Italian Republic · Ministry of the Treasury",
    native: "Repubblica Italiana · Ministero del Tesoro",
  },
  ES: {
    glyph: "RE",
    serif: "mono",
    budgetTitle: "State Budget",
    ministry: "MINISTRY OF FINANCE",
    publicSeal: "PUBLIC RECORD",
    registry: "Kingdom of Spain · Ministry of Finance",
    native: "Reino de España · Ministerio de Hacienda",
  },
  SE: {
    glyph: "SE",
    serif: "mono",
    budgetTitle: "State Budget",
    ministry: "MINISTRY OF FINANCE",
    publicSeal: "PUBLIC RECORD",
    registry: "Kingdom of Sweden · Ministry of Finance",
    native: "Konungariket Sverige · Finansdepartementet",
  },
  TR: {
    glyph: "TC",
    serif: "mono",
    budgetTitle: "State Budget",
    ministry: "MINISTRY OF FINANCE",
    publicSeal: "PUBLIC RECORD",
    registry: "Republic of Turkey · Ministry of Finance",
    native: "Türkiye Cumhuriyeti · Maliye Bakanlığı",
  },
  GR: {
    glyph: "ΕΔ",
    serif: "mono",
    budgetTitle: "State Budget",
    ministry: "MINISTRY OF FINANCE",
    publicSeal: "PUBLIC RECORD",
    registry: "Hellenic Republic · Ministry of Finance",
    native: "Ελληνική Δημοκρατία · Υπουργείο Οικονομικών",
  },
  AT: {
    glyph: "BM",
    serif: "mono",
    budgetTitle: "Federal Budget",
    ministry: "MINISTRY OF FINANCE",
    publicSeal: "PUBLIC RECORD",
    registry: "Republic of Austria · Federal Ministry of Finance",
    native: "Republik Österreich · Bundesministerium für Finanzen",
  },
  FI: {
    glyph: "VM",
    serif: "mono",
    budgetTitle: "State Budget",
    ministry: "MINISTRY OF FINANCE",
    publicSeal: "PUBLIC RECORD",
    registry: "Republic of Finland · Ministry of Finance",
    native: "Suomen Tasavalta · Valtiovarainministeriö",
  },
  DD: DD_IDENTITY.treasuryText,
  SCO: {
    glyph: "AB",
    serif: "mono",
    budgetTitle: "Scottish Budget",
    ministry: "SCOTTISH GOVERNMENT",
    publicSeal: "PUBLIC RECORD",
    registry: "Scotland · Scottish Government Finance",
    native: "Scottish Government · Finance Directorate",
  },
  WAL: {
    glyph: "CY",
    serif: "mono",
    budgetTitle: "Welsh Budget",
    ministry: "WELSH GOVERNMENT",
    publicSeal: "PUBLIC RECORD",
    registry: "Wales · Welsh Government Finance",
    native: "Welsh Government · Finance Directorate",
  },
};

export const TREASURY_IDENTITY: Record<CountryId, TreasuryIdentity> = Object.fromEntries(
  (Object.keys(TREASURY_TEXT) as CountryId[]).map((c) => {
    const n = getNationalIdentity(c);
    return [
      c,
      {
        ...TREASURY_TEXT[c],
        palette: n.palette,
        accent: n.accent,
        accentSoft: n.accentSoft,
      },
    ];
  })
) as Record<CountryId, TreasuryIdentity>;

export function getTreasuryIdentity(c: CountryId): TreasuryIdentity {
  return TREASURY_IDENTITY[c] ?? TREASURY_IDENTITY.US;
}
