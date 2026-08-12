import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { getNationalIdentity, type NationalIdentity } from "@/lib/constants/nationalIdentity";

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

type IdentityText = Omit<InstitutionIdentity, "palette" | "accent" | "accentSoft">;

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

const EXECUTIVE_TEXT: Record<CountryId, IdentityText> = {
  US: {
    glyph: "★",
    serif: "mono",
    registry: "Executive Office of the President",
    title: "The White House",
  },
  UK: {
    glyph: "HM",
    serif: "mono",
    registry: "United Kingdom · His Majesty's Government",
    title: "10 Downing Street",
  },
  DE: {
    glyph: "BK",
    serif: "mono",
    registry: "Federal Republic of Germany · Federal Government",
    title: "Bundeskanzleramt",
    titleEn: "Federal Chancellery",
  },
  JP: {
    glyph: "閣",
    serif: "cjk",
    registry: "Japan · Cabinet of the Government",
    title: "首相官邸",
    titleEn: "Office of the Prime Minister",
  },
  IE: {
    glyph: "DT",
    serif: "mono",
    registry: "Ireland · Government of Ireland",
    title: "Tithe an Rialtais",
    titleEn: "Government Buildings",
  },
  CN: {
    glyph: "政",
    serif: "cjk",
    registry: "People's Republic of China · Executive Organs",
    title: "国务院",
    titleEn: "State Council & Government",
  },
  BR: {
    glyph: "PR",
    serif: "mono",
    registry: "Federative Republic of Brazil · Presidency",
    title: "Palácio do Planalto",
    titleEn: "Presidential Palace",
  },
  NG: {
    glyph: "FG",
    serif: "mono",
    registry: "Federal Republic of Nigeria · Presidency",
    title: "Aso Rock Villa",
  },
  HU: {
    glyph: "MT",
    serif: "mono",
    registry: "Hungarian People's Republic · Council of Ministers",
    title: "Parliament House",
  },
  PL: {
    glyph: "RM",
    serif: "mono",
    registry: "Polish People's Republic · Council of Ministers",
    title: "Sejm",
  },
  RO: {
    glyph: "CM",
    serif: "mono",
    registry: "Socialist Republic of Romania · Council of Ministers",
    title: "Grand National Assembly",
  },
  YU: {
    glyph: "SK",
    serif: "mono",
    registry: "SFR Yugoslavia · Federal Executive Council",
    title: "Federal Assembly",
  },
  BG: {
    glyph: "MS",
    serif: "mono",
    registry: "People's Republic of Bulgaria · Council of Ministers",
    title: "National Assembly",
  },
  BLR: {
    glyph: "CK",
    serif: "mono",
    registry: "Byelorussian SSR · Council of Ministers",
    title: "Supreme Soviet",
  },
  UKR: {
    glyph: "YK",
    serif: "mono",
    registry: "Ukrainian SSR · Council of Ministers",
    title: "Supreme Soviet",
  },
  CS: {
    glyph: "FV",
    serif: "mono",
    registry: "Czechoslovak Socialist Republic · Federal Government",
    title: "Federal Assembly",
  },
  BAL: {
    glyph: "CK",
    serif: "mono",
    registry: "Baltic Soviet Republics · Councils of Ministers",
    title: "Supreme Soviet",
  },
  RU: {
    glyph: "CCCP",
    serif: "mono",
    registry: "Union of Soviet Socialist Republics · Council of Ministers",
    title: "The Kremlin",
  },
  FR: {
    glyph: "RF",
    serif: "mono",
    registry: "French Republic · Presidency of the Republic",
    title: "Élysée Palace",
  },
  IT: {
    glyph: "RI",
    serif: "mono",
    registry: "Italian Republic · Presidency of the Council",
    title: "Palazzo Chigi",
  },
  ES: {
    glyph: "RE",
    serif: "mono",
    registry: "Kingdom of Spain · Presidency of the Government",
    title: "La Moncloa",
  },
  SE: {
    glyph: "SE",
    serif: "mono",
    registry: "Kingdom of Sweden · Government Offices",
    title: "Rosenbad",
  },
  TR: {
    glyph: "TC",
    serif: "mono",
    registry: "Republic of Turkey · Prime Ministry",
    title: "Çankaya",
  },
  GR: {
    glyph: "ΕΔ",
    serif: "mono",
    registry: "Hellenic Republic · Government",
    title: "Μέγαρο Μαξίμου",
    titleEn: "Maximos Mansion",
  },
  AT: {
    glyph: "BK",
    serif: "mono",
    registry: "Republic of Austria · Federal Government",
    title: "Ballhausplatz",
    titleEn: "Federal Chancellery",
  },
  FI: {
    glyph: "VN",
    serif: "mono",
    registry: "Republic of Finland · Council of State",
    title: "Valtioneuvosto",
    titleEn: "Government Palace",
  },
  DD: {
    glyph: "DDR",
    serif: "mono",
    registry: "German Democratic Republic · Council of Ministers",
    // Seat-of-government place name (the RU "The Kremlin" convention) — the
    // Volkskammer is the LEGISLATURE and titles that page instead.
    title: "Altes Stadthaus",
  },
  SCO: {
    glyph: "FM",
    serif: "mono",
    registry: "Scotland · Scottish Government",
    title: "Bute House",
  },
  WAL: {
    glyph: "FM",
    serif: "mono",
    registry: "Wales · Welsh Government",
    title: "Welsh Government",
  },
};

export function getExecutiveIdentity(countryId: CountryId): InstitutionIdentity {
  return composeFromNational(countryId, EXECUTIVE_TEXT[countryId] ?? EXECUTIVE_TEXT.US);
}

// ── National Policy (code of law) ────────────────────────────────────────────

const POLICY_TEXT: Record<CountryId, IdentityText> = {
  US: {
    glyph: "§",
    serif: "mono",
    registry: "Code of National Law · United States",
    title: "National Policy",
  },
  UK: {
    glyph: "§",
    serif: "mono",
    registry: "Statute Book · United Kingdom",
    title: "National Policy",
  },
  DE: {
    glyph: "§",
    serif: "mono",
    registry: "Code of National Law · Federal Republic of Germany",
    title: "Bundesrecht",
    titleEn: "National Policy",
  },
  JP: {
    glyph: "法",
    serif: "cjk",
    registry: "Code of National Law · Japan",
    title: "国家法令",
    titleEn: "National Policy",
  },
  IE: {
    glyph: "§",
    serif: "mono",
    registry: "Code of National Law · Ireland",
    title: "National Policy",
  },
  CN: {
    glyph: "法",
    serif: "cjk",
    registry: "Code of National Law · People's Republic of China",
    title: "国家法律",
    titleEn: "National Policy",
  },
  BR: {
    glyph: "§",
    serif: "mono",
    registry: "Code of National Law · Federative Republic of Brazil",
    title: "Direito Nacional",
    titleEn: "National Policy",
  },
  NG: {
    glyph: "§",
    serif: "mono",
    registry: "Code of National Law · Federal Republic of Nigeria",
    title: "National Policy",
  },
  HU: {
    glyph: "§",
    serif: "mono",
    registry: "Code of Law · Hungarian People's Republic",
    title: "National Policy",
  },
  PL: {
    glyph: "§",
    serif: "mono",
    registry: "Code of Law · Polish People's Republic",
    title: "National Policy",
  },
  RO: {
    glyph: "§",
    serif: "mono",
    registry: "Code of Law · Socialist Republic of Romania",
    title: "National Policy",
  },
  YU: {
    glyph: "§",
    serif: "mono",
    registry: "Code of Law · SFR Yugoslavia",
    title: "National Policy",
  },
  BG: {
    glyph: "§",
    serif: "mono",
    registry: "Code of Law · People's Republic of Bulgaria",
    title: "National Policy",
  },
  BLR: {
    glyph: "§",
    serif: "mono",
    registry: "Code of Law · Byelorussian SSR",
    title: "National Policy",
  },
  UKR: {
    glyph: "§",
    serif: "mono",
    registry: "Code of Law · Ukrainian SSR",
    title: "National Policy",
  },
  CS: {
    glyph: "§",
    serif: "mono",
    registry: "Code of Law · Czechoslovak Socialist Republic",
    title: "National Policy",
  },
  BAL: {
    glyph: "§",
    serif: "mono",
    registry: "Code of Law · Baltic Soviet Republics",
    title: "National Policy",
  },
  RU: {
    glyph: "§",
    serif: "mono",
    registry: "Code of Law · Union of Soviet Socialist Republics",
    title: "National Policy",
  },
  FR: {
    glyph: "§",
    serif: "mono",
    registry: "Code of Law · French Republic",
    title: "National Policy",
  },
  IT: {
    glyph: "§",
    serif: "mono",
    registry: "Code of Law · Italian Republic",
    title: "National Policy",
  },
  ES: {
    glyph: "§",
    serif: "mono",
    registry: "Code of Law · Kingdom of Spain",
    title: "National Policy",
  },
  SE: {
    glyph: "§",
    serif: "mono",
    registry: "Code of Law · Kingdom of Sweden",
    title: "National Policy",
  },
  TR: {
    glyph: "§",
    serif: "mono",
    registry: "Code of Law · Republic of Turkey",
    title: "National Policy",
  },
  GR: {
    glyph: "§",
    serif: "mono",
    registry: "Code of Law · Hellenic Republic",
    title: "National Policy",
  },
  AT: {
    glyph: "§",
    serif: "mono",
    registry: "Code of Law · Republic of Austria",
    title: "National Policy",
  },
  FI: {
    glyph: "§",
    serif: "mono",
    registry: "Code of Law · Republic of Finland",
    title: "National Policy",
  },
  DD: {
    glyph: "§",
    serif: "mono",
    registry: "Code of Law · German Democratic Republic",
    title: "National Policy",
  },
  SCO: {
    glyph: "§",
    serif: "mono",
    registry: "Statute Book · Scotland",
    title: "National Policy",
  },
  WAL: {
    glyph: "§",
    serif: "mono",
    registry: "Statute Book · Wales",
    title: "National Policy",
  },
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
  JP: {
    countryId: "JP",
    text: {
      glyph: "¥",
      serif: "cjk",
      registry: "Monetary Authority · Japan",
      title: "日本銀行",
      titleEn: "Bank of Japan",
    },
  },
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
