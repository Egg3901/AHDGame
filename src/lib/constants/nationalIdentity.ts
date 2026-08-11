import type { CountryId } from "@/lib/constants/countries";

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
  CN: {
    glyph: "国",
    serif: "cjk",
    motif: "gearStar",
    name: "China National Corporation",
    native: "中国国有企业总公司",
    registry: "People's Republic of China · State Asset Registry",
    ministry: "经济部 · ECONOMY MINISTRY",
    publicSeal: "公开 · PUBLIC REGISTER",
    hqCity: "Beijing",
    palette: ["#4a1212", "#2a0e0e", "#160a0e"],
    accent: "#d8b25e",
    accentSoft: "#e7cd91",
    accentName: "Crimson & gold",
  },
  UK: {
    glyph: "HM",
    serif: "mono",
    motif: "laurel",
    name: "United Kingdom National Corporation",
    native: "His Majesty's National Enterprise",
    registry: "United Kingdom · Crown Asset Register",
    ministry: "HM TREASURY",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "London",
    palette: ["#16233f", "#101a30", "#0c1018"],
    accent: "#c9a24b",
    accentSoft: "#e1c382",
    accentName: "Westminster navy & gold",
  },
  US: {
    glyph: "US",
    serif: "mono",
    motif: "starRing",
    name: "United States National Corporation",
    native: "Federal Enterprise Holdings",
    registry: "United States · Federal Asset Registry",
    ministry: "U.S. TREASURY",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Washington, D.C.",
    palette: ["#1b2747", "#121b33", "#0b0f1c"],
    accent: "#b9933f",
    accentSoft: "#d9b970",
    accentName: "Federal navy & brass",
  },
  DE: {
    glyph: "BU",
    serif: "mono",
    motif: "gear",
    name: "Germany National Corporation",
    native: "Bundesunternehmen Deutschland",
    registry: "Bundesrepublik Deutschland · Staatsvermögen",
    ministry: "BMF · FINANZEN",
    publicSeal: "ÖFFENTLICHES REGISTER",
    hqCity: "Berlin",
    palette: ["#2a2218", "#1a150d", "#100c07"],
    accent: "#d4a244",
    accentSoft: "#e8c884",
    accentName: "Schwarz-Gold",
  },
  JP: {
    glyph: "日",
    serif: "cjk",
    motif: "rays",
    name: "Japan National Corporation",
    native: "日本国有企業",
    registry: "日本国 · 国有資産登記",
    ministry: "財務省 · MOF",
    publicSeal: "公開 · PUBLIC REGISTER",
    hqCity: "Tokyo",
    palette: ["#4a1414", "#2c0d0d", "#160909"],
    accent: "#e3dcd0",
    accentSoft: "#ffffff",
    accentName: "Vermilion & ivory",
  },
  IE: {
    glyph: "ÉN",
    serif: "mono",
    motif: "knot",
    name: "Ireland National Corporation",
    native: "Corparáid Náisiúnta na hÉireann",
    registry: "Éire · Clár Sócmhainní Stáit",
    ministry: "AN ROINN · FINANCE",
    publicSeal: "CLÁR POIBLÍ",
    hqCity: "Dublin",
    palette: ["#123022", "#0d2017", "#08130d"],
    accent: "#cba24b",
    accentSoft: "#e4c886",
    accentName: "Éire green & gold",
  },
  // Not in the design bundle — same machinery, own palette. Refine when these
  // countries get their nationalization flavor pass (spec §18).
  BR: {
    glyph: "BR",
    serif: "mono",
    motif: "starRing",
    name: "Brazil National Corporation",
    native: "Empresa Nacional do Brasil",
    registry: "República Federativa do Brasil · Patrimônio do Estado",
    ministry: "TESOURO NACIONAL",
    publicSeal: "REGISTRO PÚBLICO",
    hqCity: "Brasília",
    palette: ["#0f3b24", "#0b2a19", "#07180f"],
    accent: "#d4b13f",
    accentSoft: "#e8cf78",
    accentName: "Verde-amarelo",
  },
  NG: {
    glyph: "NG",
    serif: "mono",
    motif: "gear",
    name: "Nigeria National Corporation",
    native: "Nigeria National Enterprise",
    registry: "Federal Republic of Nigeria · State Asset Registry",
    ministry: "FEDERAL TREASURY",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Abuja",
    palette: ["#0d3527", "#0a261c", "#06150f"],
    accent: "#cdb15a",
    accentSoft: "#e2cd8c",
    accentName: "Naija green & gold",
  },
  HU: {
    glyph: "HU",
    serif: "mono",
    motif: "gearStar",
    name: "Hungarian State Holdings",
    native: "Magyar Állami Vállalat",
    registry: "Hungarian People's Republic · State Asset Registry",
    ministry: "STATE PLANNING OFFICE",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Budapest",
    palette: ["#3a0d0d", "#2a0a0a", "#150606"],
    accent: "#cdb15a",
    accentSoft: "#e2cd8c",
    accentName: "Magyar red & gold",
  },
  PL: {
    glyph: "PL",
    serif: "mono",
    motif: "gearStar",
    name: "Polish State Holdings",
    native: "Polskie Przedsiębiorstwo Państwowe",
    registry: "Polish People's Republic · State Asset Registry",
    ministry: "STATE PLANNING COMMISSION",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Warsaw",
    palette: ["#3a0d0d", "#2a0a0a", "#150606"],
    accent: "#cdb15a",
    accentSoft: "#e2cd8c",
    accentName: "Polish red & gold",
  },
  RO: {
    glyph: "RO",
    serif: "mono",
    motif: "gearStar",
    name: "Romanian State Holdings",
    native: "Întreprindere de Stat",
    registry: "Socialist Republic of Romania · State Asset Registry",
    ministry: "STATE PLANNING COMMITTEE",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Bucharest",
    palette: ["#0d2a3a", "#0a1f2a", "#061015"],
    accent: "#cdb15a",
    accentSoft: "#e2cd8c",
    accentName: "Romanian blue & gold",
  },
  YU: {
    glyph: "YU",
    serif: "mono",
    motif: "gearStar",
    name: "Yugoslav Social Enterprise",
    native: "Društveno Preduzeće",
    registry: "SFR Yugoslavia · Self-Management Registry",
    ministry: "FEDERAL PLANNING INSTITUTE",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Belgrade",
    palette: ["#1a2a3a", "#121f2a", "#0a1015"],
    accent: "#9aa7c5",
    accentSoft: "#c2cbe0",
    accentName: "Yugoslav blue",
  },
  BG: {
    glyph: "BG",
    serif: "mono",
    motif: "gearStar",
    name: "Bulgarian State Holdings",
    native: "Държавно Предприятие",
    registry: "People's Republic of Bulgaria · State Asset Registry",
    ministry: "STATE PLANNING COMMITTEE",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Sofia",
    palette: ["#0d3527", "#0a261c", "#06150f"],
    accent: "#cdb15a",
    accentSoft: "#e2cd8c",
    accentName: "Bulgarian green & gold",
  },
  BLR: {
    glyph: "BLR",
    serif: "mono",
    motif: "gearStar",
    name: "Byelorussian State Enterprise",
    native: "Дзяржаўнае Прадпрыемства",
    registry: "Byelorussian SSR · State Asset Registry",
    ministry: "GOSPLAN",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Minsk",
    palette: ["#3a0d0d", "#2a0a0a", "#150606"],
    accent: "#cdb15a",
    accentSoft: "#e2cd8c",
    accentName: "Soviet red & gold",
  },
  UKR: {
    glyph: "UKR",
    serif: "mono",
    motif: "gearStar",
    name: "Ukrainian State Enterprise",
    native: "Державне Підприємство",
    registry: "Ukrainian SSR · State Asset Registry",
    ministry: "GOSPLAN URSR",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Kyiv",
    palette: ["#3a0d0d", "#2a0a0a", "#150606"],
    accent: "#cdb15a",
    accentSoft: "#e2cd8c",
    accentName: "Soviet red & gold",
  },
  CS: {
    glyph: "CS",
    serif: "mono",
    motif: "gearStar",
    name: "Czechoslovak State Enterprise",
    native: "Státní Podnik",
    registry: "Czechoslovak Socialist Republic · State Asset Registry",
    ministry: "STATE PLANNING COMMISSION",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Prague",
    palette: ["#1a2a3a", "#121f2a", "#0a1015"],
    accent: "#cdb15a",
    accentSoft: "#e2cd8c",
    accentName: "Czechoslovak blue & gold",
  },
  BAL: {
    glyph: "BAL",
    serif: "mono",
    motif: "gearStar",
    name: "Baltic State Enterprise",
    native: "Valsts Uzņēmums",
    registry: "Baltic Soviet Republics · State Asset Registry",
    ministry: "GOSPLAN",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Riga",
    palette: ["#3a0d0d", "#2a0a0a", "#150606"],
    accent: "#cdb15a",
    accentSoft: "#e2cd8c",
    accentName: "Soviet red & gold",
  },
  RU: {
    glyph: "СССР",
    serif: "mono",
    motif: "gearStar",
    name: "All-Union State Enterprise",
    native: "Государственное Предприятие СССР",
    registry: "Union of Soviet Socialist Republics · State Asset Registry",
    ministry: "GOSPLAN",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Moscow",
    palette: ["#3a0d0d", "#2a0a0a", "#150606"],
    accent: "#cdb15a",
    accentSoft: "#e2cd8c",
    accentName: "Soviet red & gold",
  },
  FR: {
    glyph: "RF",
    serif: "mono",
    motif: "gear",
    name: "French State Enterprise",
    native: "Entreprise Publique",
    registry: "French Republic · State Holdings Registry",
    ministry: "MINISTRY OF FINANCE",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Paris",
    palette: ["#0d1a3a", "#0a132a", "#060a15"],
    accent: "#c0c8e0",
    accentSoft: "#dde2f2",
    accentName: "Tricolore blue",
  },
  IT: {
    glyph: "RI",
    serif: "mono",
    motif: "gear",
    name: "Italian State Holdings",
    native: "Ente Pubblico (IRI/ENI)",
    registry: "Italian Republic · State Holdings Registry",
    ministry: "MINISTRY OF THE TREASURY",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Rome",
    palette: ["#0d3320", "#0a2618", "#06150d"],
    accent: "#cdb15a",
    accentSoft: "#e2cd8c",
    accentName: "Italian green & gold",
  },
  ES: {
    glyph: "RE",
    serif: "mono",
    motif: "gear",
    name: "Spanish State Enterprise",
    native: "Empresa Pública (INI)",
    registry: "Kingdom of Spain · State Holdings Registry",
    ministry: "MINISTRY OF FINANCE",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Madrid",
    palette: ["#3a0d0d", "#2a0a0a", "#150606"],
    accent: "#cdb15a",
    accentSoft: "#e2cd8c",
    accentName: "Spanish red & gold",
  },
  SE: {
    glyph: "SE",
    serif: "mono",
    motif: "gear",
    name: "Swedish State Enterprise",
    native: "Statligt Bolag",
    registry: "Kingdom of Sweden · State Holdings Registry",
    ministry: "MINISTRY OF FINANCE",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Stockholm",
    palette: ["#0d2540", "#0a1c30", "#06101c"],
    accent: "#f5c542",
    accentSoft: "#ffe08a",
    accentName: "Swedish blue & yellow",
  },
  TR: {
    glyph: "TC",
    serif: "mono",
    motif: "gear",
    name: "Turkish State Enterprise",
    native: "Kamu İktisadi Teşekkülü (KİT)",
    registry: "Republic of Turkey · State Holdings Registry",
    ministry: "MINISTRY OF FINANCE",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Ankara",
    palette: ["#3a0d0d", "#2a0a0a", "#150606"],
    accent: "#e02a2a",
    accentSoft: "#f08a8a",
    accentName: "Turkish red & white",
  },
  GR: {
    glyph: "ΕΔ",
    serif: "mono",
    motif: "laurel",
    name: "Hellenic State Enterprise",
    native: "Ελληνική Δημόσια Επιχείρηση",
    registry: "Hellenic Republic · State Holdings Registry",
    ministry: "MINISTRY OF FINANCE",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Athens",
    palette: ["#0d2a4a", "#0a1f38", "#06101c"],
    accent: "#3d8fd6",
    accentSoft: "#8ec2ea",
    accentName: "Aegean blue & white",
  },
  AT: {
    glyph: "ÖS",
    serif: "mono",
    motif: "laurel",
    name: "Austrian State Industries",
    native: "Österreichische Industrieholding",
    registry: "Republic of Austria · State Holdings Registry",
    ministry: "MINISTRY OF FINANCE",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Vienna",
    palette: ["#3a0d14", "#2a0a10", "#150608"],
    accent: "#d64545",
    accentSoft: "#eb9a9a",
    accentName: "Austrian red & white",
  },
  FI: {
    glyph: "SV",
    serif: "mono",
    motif: "gear",
    name: "Finnish State Company",
    native: "Suomen Valtionyhtiö",
    registry: "Republic of Finland · State Holdings Registry",
    ministry: "MINISTRY OF FINANCE",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Helsinki",
    palette: ["#0d2038", "#0a1830", "#060d18"],
    accent: "#4a7fc0",
    accentSoft: "#93b8e0",
    accentName: "Nordic blue & white",
  },
  DD: {
    glyph: "DDR",
    serif: "mono",
    motif: "gearStar",
    name: "Volkseigener Betrieb",
    native: "VEB Kombinat",
    registry: "German Democratic Republic · State Asset Registry",
    ministry: "STATE PLANNING COMMISSION",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "East Berlin",
    palette: ["#3a0d0d", "#2a0a0a", "#150606"],
    accent: "#cdb15a",
    accentSoft: "#e2cd8c",
    accentName: "Socialist red & gold",
  },
  // Latent secession country — Scottish flavor; refined at activation (SP2).
  SCO: {
    glyph: "AB",
    serif: "mono",
    motif: "laurel",
    name: "Scotland National Corporation",
    native: "Scottish National Enterprise",
    registry: "Scotland · National Asset Register",
    ministry: "SCOTTISH GOVERNMENT",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Edinburgh",
    palette: ["#16233f", "#101a30", "#0c1018"],
    accent: "#c9a24b",
    accentSoft: "#e1c382",
    accentName: "Saltire navy & gold",
  },
  // Latent secession country — Welsh flavor; refined at activation (SP2).
  WAL: {
    glyph: "CY",
    serif: "mono",
    motif: "laurel",
    name: "Wales National Corporation",
    native: "Welsh National Enterprise",
    registry: "Wales · National Asset Register",
    ministry: "WELSH GOVERNMENT",
    publicSeal: "PUBLIC REGISTER",
    hqCity: "Cardiff",
    palette: ["#3a1414", "#260d0d", "#160808"],
    accent: "#c9a24b",
    accentSoft: "#e1c382",
    accentName: "Y Ddraig Goch red & gold",
  },
};

export function getNationalIdentity(countryId: CountryId): NationalIdentity {
  return NATIONAL_IDENTITY[countryId] ?? NATIONAL_IDENTITY.US;
}
