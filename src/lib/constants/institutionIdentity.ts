import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { getNationalIdentity, type NationalIdentity } from "@/lib/constants/nationalIdentity";
import { JP_IDENTITY } from "@/lib/countries/jp/identity";
import { JP_BANK_TEXT } from "@/lib/countries/jp/identity";
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
 * Institution identity overlays for the country-pages masthead family
 * (Executive · National Policy · Central Bank) — the same grammar as
 * `treasuryIdentity.ts`: per-surface TEXT (glyph, registry eyebrow, serif
 * title) overlaid on the country's fixed brand colors from
 * `getNationalIdentity`, so there is one source of brand truth.
 *
 * Bank identities are keyed off the BANK (`getBankId`), not the country —
 * DE alone carries the ECB shared-bank record (EU palette). IE has its own
 * Central Bank of Ireland identity under bank id `IE`.
 */
export interface InstitutionIdentity {
  /** Watermark + seal glyph — a single CJK character, currency sign, §, or short monogram. */
  glyph: string;
  /** Whether the glyph/title render in a CJK serif (`cjk`) or serif monogram (`mono`). */
  serif: "cjk" | "mono";
  /** Registry eyebrow line above the title. */
  registry: string;
  /** Masthead title (original language). */
  title: string;
  /** English subtitle, shown when `title` is non-English. */
  titleEn?: string;
  /** Banner gradient stops (shared brand color). */
  palette: NationalIdentity["palette"];
  /** Accent line / seal stroke. */
  accent: string;
  /** Lighter accent for glyph fill / hairlines. */
  accentSoft: string;
}

export type IdentityText = Omit<InstitutionIdentity, "palette" | "accent" | "accentSoft">;

function composeFromNational(countryId: CountryId, text: IdentityText): InstitutionIdentity {
  const national = getNationalIdentity(countryId);
  return {
    ...text,
    palette: national.palette,
    accent: national.accent,
    accentSoft: national.accentSoft,
  };
}

// ── Executive ────────────────────────────────────────────────────────────────

export const EXECUTIVE_TEXT: Record<CountryId, IdentityText> = {
  US: US_IDENTITY.executiveText,
  UK: UK_IDENTITY.executiveText,
  DE: DE_IDENTITY.executiveText,
  JP: JP_IDENTITY.executiveText,
  IE: IE_IDENTITY.executiveText,
  CN: CN_IDENTITY.executiveText,
  BR: BR_IDENTITY.executiveText,
  NG: NG_IDENTITY.executiveText,
  HU: HU_IDENTITY.executiveText,
  PL: PL_IDENTITY.executiveText,
  RO: RO_IDENTITY.executiveText,
  YU: YU_IDENTITY.executiveText,
  BG: BG_IDENTITY.executiveText,
  BLR: BLR_IDENTITY.executiveText,
  UKR: UKR_IDENTITY.executiveText,
  CS: CS_IDENTITY.executiveText,
  BAL: BAL_IDENTITY.executiveText,
  RU: RU_IDENTITY.executiveText,
  FR: FR_IDENTITY.executiveText,
  IT: IT_IDENTITY.executiveText,
  ES: ES_IDENTITY.executiveText,
  SE: SE_IDENTITY.executiveText,
  TR: TR_IDENTITY.executiveText,
  GR: GR_IDENTITY.executiveText,
  AT: AT_IDENTITY.executiveText,
  FI: FI_IDENTITY.executiveText,
  DD: DD_IDENTITY.executiveText,
  SCO: SCO_IDENTITY.executiveText,
  WAL: WAL_IDENTITY.executiveText,
};

export function getExecutiveIdentity(countryId: CountryId): InstitutionIdentity {
  return composeFromNational(countryId, EXECUTIVE_TEXT[countryId] ?? EXECUTIVE_TEXT.US);
}

// ── National Policy (code of law) ────────────────────────────────────────────

export const POLICY_TEXT: Record<CountryId, IdentityText> = {
  US: US_IDENTITY.policyText,
  UK: UK_IDENTITY.policyText,
  DE: DE_IDENTITY.policyText,
  JP: JP_IDENTITY.policyText,
  IE: IE_IDENTITY.policyText,
  CN: CN_IDENTITY.policyText,
  BR: BR_IDENTITY.policyText,
  NG: NG_IDENTITY.policyText,
  HU: HU_IDENTITY.policyText,
  PL: PL_IDENTITY.policyText,
  RO: RO_IDENTITY.policyText,
  YU: YU_IDENTITY.policyText,
  BG: BG_IDENTITY.policyText,
  BLR: BLR_IDENTITY.policyText,
  UKR: UKR_IDENTITY.policyText,
  CS: CS_IDENTITY.policyText,
  BAL: BAL_IDENTITY.policyText,
  RU: RU_IDENTITY.policyText,
  FR: FR_IDENTITY.policyText,
  IT: IT_IDENTITY.policyText,
  ES: ES_IDENTITY.policyText,
  SE: SE_IDENTITY.policyText,
  TR: TR_IDENTITY.policyText,
  GR: GR_IDENTITY.policyText,
  AT: AT_IDENTITY.policyText,
  FI: FI_IDENTITY.policyText,
  DD: DD_IDENTITY.policyText,
  SCO: SCO_IDENTITY.policyText,
  WAL: WAL_IDENTITY.policyText,
};

export function getPolicyIdentity(countryId: CountryId): InstitutionIdentity {
  return composeFromNational(countryId, POLICY_TEXT[countryId] ?? POLICY_TEXT.US);
}

// ── Central Bank (keyed by bank id from getBankId) ──────────────────────────

/**
 * The ECB is a shared institution — it gets its own EU palette rather than
 * borrowing a member state's national colors. Per-country banks compose from
 * their national identity as usual. (IE has its own Central Bank of Ireland
 * doc; DE alone carries the ECB shared bank id.)
 */
const ECB_IDENTITY: InstitutionIdentity = {
  glyph: "€",
  serif: "mono",
  registry: "Monetary Authority · Eurosystem",
  title: "European Central Bank",
  palette: ["#101c3a", "#152448", "#0c1530"],
  accent: "#f5c542",
  accentSoft: "#fadf8e",
};

const BANK_TEXT: Record<string, { countryId: CountryId; text: IdentityText }> = {
  US: {
    countryId: "US",
    text: {
      glyph: "$",
      serif: "mono",
      registry: "Monetary Authority · United States · Independent",
      title: "The Federal Reserve",
    },
  },
  UK: {
    countryId: "UK",
    text: {
      glyph: "£",
      serif: "mono",
      registry: "Monetary Authority · United Kingdom",
      title: "Bank of England",
    },
  },
  JP: { countryId: "JP", text: JP_BANK_TEXT },
  CN: {
    countryId: "CN",
    text: {
      glyph: "¥",
      serif: "cjk",
      registry: "Monetary Authority · People's Republic of China",
      title: "中国人民银行",
      titleEn: "People's Bank of China",
    },
  },
  BR: {
    countryId: "BR",
    text: {
      glyph: "R$",
      serif: "mono",
      registry: "Monetary Authority · Federative Republic of Brazil",
      title: "Banco Central do Brasil",
      titleEn: "Central Bank of Brazil",
    },
  },
  NG: {
    countryId: "NG",
    text: {
      glyph: "₦",
      serif: "mono",
      registry: "Monetary Authority · Federal Republic of Nigeria",
      title: "Central Bank of Nigeria",
    },
  },
  IE: {
    countryId: "IE",
    text: {
      glyph: "IR£",
      serif: "mono",
      registry: "Monetary Authority · Ireland",
      title: "Banc Ceannais na hÉireann",
      titleEn: "Central Bank of Ireland",
    },
  },
};

const BANK_IDENTITY: Record<string, InstitutionIdentity> = {
  ECB: ECB_IDENTITY,
  ...Object.fromEntries(
    Object.entries(BANK_TEXT).map(([bankId, entry]) => [
      bankId,
      composeFromNational(entry.countryId, entry.text),
    ])
  ),
};

/**
 * Identity for a bank id from `getBankId(countryId)`.
 *
 * `BANK_TEXT` only hand-authors the banks with a non-obvious masthead (native
 * script, shared institution, historical glyph). Every other country composes
 * its identity from `COUNTRY_CONFIGS[bankId].centralBank.name` and its own
 * currency symbol, so a bank without a hand-authored entry still shows its own
 * name. Falling back to the Fed made every eastern-bloc and European bank read
 * "The Federal Reserve".
 */
function composeFromConfig(bankId: string): InstitutionIdentity | null {
  const config = COUNTRY_CONFIGS[bankId as CountryId];
  if (!config) return null;
  const currency = COUNTRY_CURRENCY_MAP[bankId as CountryId];
  return composeFromNational(bankId as CountryId, {
    glyph: (currency && CURRENCY_SYMBOLS[currency]) || "§",
    serif: "mono",
    registry: `Monetary Authority · ${config.name}`,
    title: config.centralBank.name,
  });
}

export function getBankIdentity(bankId: string): InstitutionIdentity {
  return BANK_IDENTITY[bankId] ?? composeFromConfig(bankId) ?? BANK_IDENTITY.US;
}
