import type { CountryId } from "./countries";

export type LegalStructureTaxTreatment = "standard" | "pass_through" | "preferential";

export interface LegalStructure {
  id: LegalStructureId;
  countryId: CountryId;
  name: string;
  shortName: string;
  /** Country default for public / unspecified corps (one per country). */
  isDefault: boolean;
  /**
   * Preferred form when founding (or resolving a missing structure for) a
   * privately held corporation. Distinct from `isDefault` in jurisdictions
   * that separate public and private company forms (e.g. UK PLC vs Ltd).
   * When absent, private corps fall back to `isDefault`.
   */
  isPrivateDefault?: boolean;
  taxTreatment: LegalStructureTaxTreatment;
  taxMultiplier?: number;
  shareholderVoteThreshold: number;
  minimumDividendRate?: number;
  /**
   * Maximum number of distinct shareholders a private corporation with this
   * structure may have. Models real-world close-corporation caps (e.g. US S-Corp
   * is limited to 100 shareholders by IRS rules). Undefined ⇒ either CEO-only
   * (default for most private structures) or unlimited (public structures).
   * When defined and > 1, the corporation supports the private-share-invite
   * flow even while remaining "private" (no public market).
   */
  maxShareholders?: number;
  description: string;
}

export type LegalStructureId =
  | "us_c_corp"
  | "us_s_corp"
  | "us_llc"
  | "uk_plc"
  | "uk_ltd"
  | "uk_llp"
  | "jp_kk"
  | "jp_gk"
  | "de_ag"
  | "de_gmbh"
  | "de_se"
  | "ie_plc"
  | "ie_dac"
  | "ie_uc"
  | "br_sa_aberta"
  | "br_sa_fechada"
  | "br_ltda"
  | "cn_gufen"
  | "cn_youxian"
  | "cn_soe"
  | "ng_plc"
  | "ng_ltd"
  | "ng_ulc"
  | "generic_corp";

/**
 * Neutral fallback structure for countries that have no bespoke legal form yet
 * (e.g. the Cold-War-era nations seeded by the "1991-default" preset: YU, RU,
 * CS, PL, HU, RO, BG, UKR, BLR, BAL, DD, FR, IT, ES, SE, TR). Deliberately NOT a
 * member of LEGAL_STRUCTURES so it never appears in any per-country structure
 * listing — it is only ever reached via getDefaultLegalStructureId's fallback,
 * so corporationTurn can process corporations in those countries instead of
 * throwing "No default legal structure for country".
 */
export const GENERIC_LEGAL_STRUCTURE: LegalStructure = {
  id: "generic_corp",
  countryId: "US", // sentinel only; never surfaced via a countryId lookup
  name: "General Corporation",
  shortName: "Corp",
  isDefault: false,
  taxTreatment: "standard",
  shareholderVoteThreshold: 0.5,
  description:
    "Standard corporation. Neutral fallback for jurisdictions without a bespoke legal form.",
};

export const LEGAL_STRUCTURES: LegalStructure[] = [
  // ── United States ─────────────────────────────────────────────────────────
  {
    id: "us_c_corp",
    countryId: "US",
    name: "C-Corporation",
    shortName: "C-Corp",
    isDefault: true,
    taxTreatment: "standard",
    shareholderVoteThreshold: 0.5,
    description:
      "Standard US corporation. Double taxation applies; shareholders have balanced oversight.",
  },
  {
    id: "us_s_corp",
    countryId: "US",
    name: "S-Corporation",
    shortName: "S-Corp",
    isDefault: false,
    taxTreatment: "pass_through",
    shareholderVoteThreshold: 0.4,
    minimumDividendRate: 0.2,
    // IRS rule: S-Corps are capped at 100 shareholders. Models the real
    // close-corporation pattern where the CEO can bring in private investors
    // without an IPO, but the ownership pool stays small.
    maxShareholders: 100,
    description:
      "Pass-through taxation. No corporate tax but profits must be distributed. Shareholders have stronger oversight. Capped at 100 private shareholders.",
  },
  {
    id: "us_llc",
    countryId: "US",
    name: "Limited Liability Company",
    shortName: "LLC",
    isDefault: false,
    taxTreatment: "pass_through",
    shareholderVoteThreshold: 0.62,
    minimumDividendRate: 0.2,
    description: "Maximum tax efficiency and CEO autonomy. Profits must be distributed to members.",
  },
  // ── United Kingdom ────────────────────────────────────────────────────────
  {
    id: "uk_plc",
    countryId: "UK",
    name: "Public Limited Company",
    shortName: "PLC",
    isDefault: true,
    taxTreatment: "standard",
    shareholderVoteThreshold: 0.4,
    description: "Standard UK listed company. Strong shareholder protections under UK company law.",
  },
  {
    id: "uk_ltd",
    countryId: "UK",
    name: "Private Limited Company",
    shortName: "Ltd",
    isDefault: false,
    isPrivateDefault: true,
    taxTreatment: "standard",
    shareholderVoteThreshold: 0.52,
    description: "Close-held company with lighter regulatory burden. Same tax rate as PLC.",
  },
  {
    id: "uk_llp",
    countryId: "UK",
    name: "Limited Liability Partnership",
    shortName: "LLP",
    isDefault: false,
    taxTreatment: "pass_through",
    shareholderVoteThreshold: 0.65,
    minimumDividendRate: 0.25,
    description:
      "Pass-through taxation. Partners extract value directly; CEO has maximum autonomy.",
  },
  // ── Japan ─────────────────────────────────────────────────────────────────
  {
    id: "jp_kk",
    countryId: "JP",
    name: "Kabushiki Kaisha",
    shortName: "KK",
    isDefault: true,
    taxTreatment: "standard",
    shareholderVoteThreshold: 0.6,
    description:
      "Japan's standard joint-stock company. Most CEO-protective default structure in the game.",
  },
  {
    id: "jp_gk",
    countryId: "JP",
    name: "Gōdō Kaisha",
    shortName: "GK",
    isDefault: false,
    taxTreatment: "pass_through",
    shareholderVoteThreshold: 0.5,
    minimumDividendRate: 0.2,
    description:
      "Flexible pass-through structure used by major foreign subsidiaries. Balanced governance.",
  },
  // ── Germany ───────────────────────────────────────────────────────────────
  {
    id: "de_ag",
    countryId: "DE",
    name: "Aktiengesellschaft",
    shortName: "AG",
    isDefault: true,
    taxTreatment: "standard",
    shareholderVoteThreshold: 0.35,
    description:
      "Germany's public joint-stock company. Aufsichtsrat gives shareholders the strongest statutory leverage of any default.",
  },
  {
    id: "de_gmbh",
    countryId: "DE",
    name: "Gesellschaft mit beschränkter Haftung",
    shortName: "GmbH",
    isDefault: false,
    isPrivateDefault: true,
    taxTreatment: "standard",
    shareholderVoteThreshold: 0.52,
    description: "Germany's private limited company. Widely used, reliable, balanced governance.",
  },
  {
    id: "de_se",
    countryId: "DE",
    name: "Societas Europaea",
    shortName: "SE",
    isDefault: false,
    taxTreatment: "preferential",
    taxMultiplier: 0.8,
    shareholderVoteThreshold: 0.4,
    description:
      "EU-level company form. 20% reduction on effective corporate tax rate via cross-border optimisation.",
  },
  // ── Ireland ───────────────────────────────────────────────────────────────
  {
    id: "ie_plc",
    countryId: "IE",
    name: "Public Limited Company",
    shortName: "PLC",
    isDefault: true,
    taxTreatment: "standard",
    shareholderVoteThreshold: 0.5,
    description:
      "Ireland's standard listed company. Leverages Ireland's competitive corporate tax regime.",
  },
  {
    id: "ie_dac",
    countryId: "IE",
    name: "Designated Activity Company",
    shortName: "DAC",
    isDefault: false,
    isPrivateDefault: true,
    taxTreatment: "standard",
    shareholderVoteThreshold: 0.6,
    description: "Ireland's primary private form. CEO has stronger autonomy than a PLC.",
  },
  {
    id: "ie_uc",
    countryId: "IE",
    name: "Unlimited Company",
    shortName: "UC",
    isDefault: false,
    taxTreatment: "pass_through",
    shareholderVoteThreshold: 0.65,
    minimumDividendRate: 0.3,
    description: "Maximum privacy, pass-through taxation. 30% of profits must be distributed.",
  },
  // ── Brazil ────────────────────────────────────────────────────────────────
  {
    id: "br_sa_aberta",
    countryId: "BR",
    name: "Sociedade Anônima Aberta",
    shortName: "SA Aberta",
    isDefault: true,
    taxTreatment: "standard",
    shareholderVoteThreshold: 0.5,
    description:
      "Brazil's open joint-stock company. CVM-regulated with strong investor protections.",
  },
  {
    id: "br_sa_fechada",
    countryId: "BR",
    name: "Sociedade Anônima Fechada",
    shortName: "SA Fechada",
    isDefault: false,
    isPrivateDefault: true,
    taxTreatment: "standard",
    shareholderVoteThreshold: 0.6,
    description: "Brazil's closed S/A. Less disclosure, CEO retains more control.",
  },
  {
    id: "br_ltda",
    countryId: "BR",
    name: "Sociedade Limitada",
    shortName: "Ltda",
    isDefault: false,
    taxTreatment: "preferential",
    taxMultiplier: 0.82,
    shareholderVoteThreshold: 0.65,
    minimumDividendRate: 0.25,
    description:
      "JCP (Juros sobre Capital Próprio) deduction reduces effective corporate tax by 18%. Profits must be distributed.",
  },
  // ── China ─────────────────────────────────────────────────────────────────
  {
    id: "cn_gufen",
    countryId: "CN",
    name: "Gufen Youxian Gongsi",
    shortName: "Gufen",
    isDefault: true,
    taxTreatment: "standard",
    shareholderVoteThreshold: 0.45,
    description:
      "China's joint-stock company. Required for listed companies; subject to state guidance.",
  },
  {
    id: "cn_youxian",
    countryId: "CN",
    name: "Youxian Zeren Gongsi",
    shortName: "Youxian",
    isDefault: false,
    isPrivateDefault: true,
    taxTreatment: "standard",
    shareholderVoteThreshold: 0.6,
    description:
      "China's standard LLC. Dominant form for domestic and foreign-invested enterprises.",
  },
  {
    id: "cn_soe",
    countryId: "CN",
    name: "SOE-Aligned",
    shortName: "SOE",
    isDefault: false,
    taxTreatment: "preferential",
    taxMultiplier: 0.6,
    shareholderVoteThreshold: 0.72,
    description:
      "State patronage: 40% reduction on corporate tax rate. Shareholders have almost no recourse against the CEO.",
  },
  // ── Nigeria ───────────────────────────────────────────────────────────────
  {
    id: "ng_plc",
    countryId: "NG",
    name: "Public Limited Company",
    shortName: "PLC",
    isDefault: true,
    taxTreatment: "standard",
    shareholderVoteThreshold: 0.5,
    description: "Nigeria's public company form, regulated by the Corporate Affairs Commission.",
  },
  {
    id: "ng_ltd",
    countryId: "NG",
    name: "Private Limited Company",
    shortName: "Ltd",
    isDefault: false,
    isPrivateDefault: true,
    taxTreatment: "standard",
    shareholderVoteThreshold: 0.58,
    description:
      "The dominant Nigerian business form. CEO has traditional family-business autonomy.",
  },
  {
    id: "ng_ulc",
    countryId: "NG",
    name: "Unlimited Liability Company",
    shortName: "ULC",
    isDefault: false,
    taxTreatment: "pass_through",
    shareholderVoteThreshold: 0.65,
    minimumDividendRate: 0.25,
    description:
      "Nigeria's most flexible structure. Pass-through taxation with mandatory profit distribution.",
  },
];
