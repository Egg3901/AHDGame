import type { CountryId } from "@/lib/constants/countries";
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
 * National-identity layer for state-owned / National Corporation surfaces.
 *
 * Source of truth for the per-country visual identity used by the
 * `NationalSeal` / `AuthoritySeal` / `NationalMasthead` components (the
 * "state enterprise" look that diverges from the private/market corp page).
 *
 * Design origin: the Country Identity Kit in the nationalization UI design
 * bundle (`docs/superpowers/specs/2026-05-30-nationalization-ui-design/`).
 *
 * **Theming contract:** each country's `palette` (banner gradient) and `accent`
 * are intentionally *fixed brand colors* — they ARE the national identity and do
 * not change with the active theme. Everything else (card surfaces, borders,
 * body text) is rendered with `ahd-design-system` tokens in the components, so
 * the identity layer stays theme-native across all themes. A dark national
 * gradient reading like a product masthead on a light page is the intended look.
 *
 * **Marks:** original monograms / CJK glyphs / generic seal motifs only —
 * deliberately NOT official state emblems (Crown arms, Bundesadler, Irish harp),
 * to avoid IP concerns. Ministry/registry strings follow the project's
 * native-language convention: English label + original-language name.
 */
/**
 * Emblem motif ring drawn around the seal medallion (the redesigned National
 * Corporation seal — see `NationalSeal`). Each is an original geometric mark, NOT
 * an official coat of arms: a star-and-cog, a star ring, a laurel garter, an
 * industrial gear, a sunburst, an interlace knot.
 */
export type SealMotif = "gearStar" | "starRing" | "laurel" | "gear" | "rays" | "knot";

export interface NationalIdentity {
  /** Stamp glyph — a single CJK character or a short serif monogram. */
  glyph: string;
  /** Whether the glyph renders in a CJK serif (`cjk`) or a serif monogram (`mono`). */
  serif: "cjk" | "mono";
  /** Emblem ring motif around the seal medallion. */
  motif: SealMotif;
  /** Display name of the country's National Corporation. */
  name: string;
  /** Original-language name, shown as a serif subtitle. */
  native: string;
  /** Registry eyebrow line above the corp name. */
  registry: string;
  /** Official-view (ministry session) seal label. */
  ministry: string;
  /** Public-view seal label. */
  publicSeal: string;
  /** HQ city (display only). */
  hqCity: string;
  /**
   * Banner gradient stops, dark → darker. **Fixed per country** (brand color),
   * not a theme token. Length 3.
   */
  palette: readonly [string, string, string];
  /** Accent (the "gold"/metallic line + seal stroke). **Fixed per country.** */
  accent: string;
  /** Lighter accent for glyph fill / hairlines. **Fixed per country.** */
  accentSoft: string;
  /** Human label for the palette (shown in the identity-token footer). */
  accentName: string;
}

/**
 * Identity for every in-game country. Keyed by `CountryId` so any country
 * renders; the six in the design bundle (CN/UK/US/DE/JP/IE) are fully art-
 * directed, BR/NG use the same component machinery with their own palette.
 */
export const NATIONAL_IDENTITY: Record<CountryId, NationalIdentity> = {
  CN: CN_IDENTITY.national,
  UK: UK_IDENTITY.national,
  US: US_IDENTITY.national,
  DE: DE_IDENTITY.national,
  JP: JP_IDENTITY.national,
  IE: IE_IDENTITY.national,
  // Not in the design bundle — same machinery, own palette. Refine when these
  // countries get their nationalization flavor pass (spec §18).
  BR: BR_IDENTITY.national,
  NG: NG_IDENTITY.national,
  HU: HU_IDENTITY.national,
  PL: PL_IDENTITY.national,
  RO: RO_IDENTITY.national,
  YU: YU_IDENTITY.national,
  BG: BG_IDENTITY.national,
  BLR: BLR_IDENTITY.national,
  UKR: UKR_IDENTITY.national,
  CS: CS_IDENTITY.national,
  BAL: BAL_IDENTITY.national,
  RU: RU_IDENTITY.national,
  FR: FR_IDENTITY.national,
  IT: IT_IDENTITY.national,
  ES: ES_IDENTITY.national,
  SE: SE_IDENTITY.national,
  TR: TR_IDENTITY.national,
  GR: GR_IDENTITY.national,
  AT: AT_IDENTITY.national,
  FI: FI_IDENTITY.national,
  DD: DD_IDENTITY.national,
  // Latent secession country — Scottish flavor; refined at activation (SP2).
  SCO: SCO_IDENTITY.national,
  // Latent secession country — Welsh flavor; refined at activation (SP2).
  WAL: WAL_IDENTITY.national,
};

export function getNationalIdentity(countryId: CountryId): NationalIdentity {
  return NATIONAL_IDENTITY[countryId] ?? NATIONAL_IDENTITY.US;
}
