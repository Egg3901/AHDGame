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
import { NG_IDENTITY } from "@/lib/countries/ng/identity";
import { BR_IDENTITY } from "@/lib/countries/br/identity";
import { FR_IDENTITY } from "@/lib/countries/fr/identity";
import { IT_IDENTITY } from "@/lib/countries/it/identity";
import { ES_IDENTITY } from "@/lib/countries/es/identity";
import { SE_IDENTITY } from "@/lib/countries/se/identity";
import { TR_IDENTITY } from "@/lib/countries/tr/identity";
import { GR_IDENTITY } from "@/lib/countries/gr/identity";
import { AT_IDENTITY } from "@/lib/countries/at/identity";
import { FI_IDENTITY } from "@/lib/countries/fi/identity";
import { PL_IDENTITY } from "@/lib/countries/pl/identity";
import { HU_IDENTITY } from "@/lib/countries/hu/identity";
import { RO_IDENTITY } from "@/lib/countries/ro/identity";
import { YU_IDENTITY } from "@/lib/countries/yu/identity";
import { BG_IDENTITY } from "@/lib/countries/bg/identity";
import { CS_IDENTITY } from "@/lib/countries/cs/identity";
import { SCO_IDENTITY } from "@/lib/countries/sco/identity";
import { WAL_IDENTITY } from "@/lib/countries/wal/identity";
import { BLR_IDENTITY } from "@/lib/countries/blr/identity";
import { UKR_IDENTITY } from "@/lib/countries/ukr/identity";
import { BAL_IDENTITY } from "@/lib/countries/bal/identity";

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
  BR: BR_IDENTITY.treasuryText,
  NG: NG_IDENTITY.treasuryText,
  HU: HU_IDENTITY.treasuryText,
  PL: PL_IDENTITY.treasuryText,
  RO: RO_IDENTITY.treasuryText,
  YU: YU_IDENTITY.treasuryText,
  BG: BG_IDENTITY.treasuryText,
  BLR: BLR_IDENTITY.treasuryText,
  UKR: UKR_IDENTITY.treasuryText,
  CS: CS_IDENTITY.treasuryText,
  BAL: BAL_IDENTITY.treasuryText,
  RU: RU_IDENTITY.treasuryText,
  FR: FR_IDENTITY.treasuryText,
  IT: IT_IDENTITY.treasuryText,
  ES: ES_IDENTITY.treasuryText,
  SE: SE_IDENTITY.treasuryText,
  TR: TR_IDENTITY.treasuryText,
  GR: GR_IDENTITY.treasuryText,
  AT: AT_IDENTITY.treasuryText,
  FI: FI_IDENTITY.treasuryText,
  DD: DD_IDENTITY.treasuryText,
  SCO: SCO_IDENTITY.treasuryText,
  WAL: WAL_IDENTITY.treasuryText,
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
