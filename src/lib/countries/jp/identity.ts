import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { CabinetIdentity } from "@/lib/constants/cabinetIdentity";
import type { EconomyIdentity } from "@/lib/constants/economyIdentity";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";
import type { StatsIdentity } from "@/lib/constants/nationalStatsIdentity";
import type { ParliamentaryExecutiveSurface } from "@/lib/constants/parliamentaryExecutiveSurface";
import type { CensusLabelSet } from "@/lib/constants/regionCensusLabels";
import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * Japan's names, labels and surface text. Phase D2.
 *
 * ⚠️ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below
 * was read out of `__snapshots__/jp.pre-move.json`, which was emitted from the
 * live registries before anything moved. The plan's single stated risk is
 * transcription error, and 350-plus lines of hand-copying is how that risk
 * arrives, so no value here was retyped.
 *
 * ⚠️ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed
 * (`Object.fromEntries` at treasuryIdentity.ts:324) from TREASURY_TEXT plus the
 * national palette, so it recomposes itself once the text moves. The plan's D2
 * list names both; forwarding the derived one would create a second source of
 * the same values. Only the authored text moves.
 *
 * ⚠️ NO `eraNames`. ERA_COUNTRY_NAMES holds 1953 and 1979 entries for DE and RU
 * only; Japan has none. Snapshotting "Japan's value" would capture `undefined`
 * and authoring a fallback would invent an authored value, so the field is
 * absent and the harness asserts that.
 */

const cabinet: CabinetIdentity = {
  glyph: "日",
  serif: "cjk",
  gov: "#e6b85c",
  govSoft: "#f3d79a",
  g0: "#7a1d12",
  g1: "#3a0e0a",
  g2: "#1c0707",
};

const national: NationalIdentity = {
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
};

const stats: StatsIdentity = {
  glyph: "統",
  serif: "cjk",
  office: "総務省統計局",
  officeEn: "Statistics Bureau of Japan",
  title: "国家統計 (National Statistics)",
  titleEn: "National Statistics",
  registry: "Japan · Statistics Bureau",
  seal: "統計局 · SBJ",
  accent: {
    stat: "#e6b85c",
    statSoft: "#f3d79a",
    g0: "#7a1d12",
    g1: "#3a0e0a",
    g2: "#1c0707",
  },
};

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "日",
  serif: "cjk",
  budgetTitle: "国家予算",
  budgetTitleEn: "National Budget",
  ministry: "財務省 · MOF",
  publicSeal: "公開 · PUBLIC",
  registry: "Japan · Ministry of Finance",
  native: "日本国 · 財務省",
  nativeEn: "Japan · Ministry of Finance",
};

const economyText: Omit<EconomyIdentity, "accent"> = {
  glyph: "経",
  serif: "cjk",
  title: "経済展望",
  titleEn: "Economic Outlook",
  office: "内閣府 · 経済社会総合研究所",
  officeEn: "Cabinet Office · Economic and Social Research Institute",
  registry: "Japan · National Accounts Registry",
};

const executiveText: IdentityText = {
  glyph: "閣",
  serif: "cjk",
  registry: "Japan · Cabinet of the Government",
  title: "首相官邸",
  titleEn: "Office of the Prime Minister",
};

const policyText: IdentityText = {
  glyph: "法",
  serif: "cjk",
  registry: "Code of National Law · Japan",
  title: "国家法令",
  titleEn: "National Policy",
};

const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Emblem_of_the_Prime_Minister_of_Japan.svg/330px-Emblem_of_the_Prime_Minister_of_Japan.svg.png",
  alt: "Emblem of the Prime Minister of Japan",
  backing: "plain",
};

const executiveSurface: ExecutiveSurfaceConfig = {
  clock: {
    kind: "election",
    label: "Term Clock",
    countdownNoun: "next general election",
  },
  actLabels: {
    signed: "ENACTED",
    vetoed: "REJECTED",
    onDesk: "AWAITING",
    order: "ORDER",
    confirmed: "APPOINTED",
    nominated: "NOMINATED",
    acting: "ACTING",
  },
  deskKind: "orders",
  deskLabel: "Orders in Force",
  rosterTitle: "Cabinet",
  heroImage: "/api/images/hero/kantei",
  heroAlt: "Prime Minister's Official Residence, Tokyo",
};

/**
 * The PARLIAMENTARY surface. `onePartyExecutiveSurface.ts` declares a symbol of
 * the same name that is not Japan's and does not move.
 */
const parliamentarySurface: ParliamentaryExecutiveSurface = {
  executiveTitle: "Prime Minister",
  memberLabel: "MP",
  headPlaque: {
    title: "Prime Minister",
    sealGlyph: "総",
    vacancyNote: "A qualifying party or coalition chair may nominate a Prime Minister.",
  },
  oppositionPlaque: {
    title: "Leader of the Opposition",
    sealGlyph: "野",
    vacancyNote: "The leader of the largest opposition party in the Diet.",
  },
  seatsPanel: {
    title: "Shūgiin seats by party",
    emptyText: "No Diet members elected yet.",
  },
  hero: {
    image: "/api/images/hero/kantei",
    alt: "Naikaku Sōri Daijin Kantei",
    title: "Government of Japan",
    tagline: "Naikaku Sōri Daijin Kantei · Cabinet and the Kokkai",
    breadcrumbLast: "Naikaku Sōri Daijin Kantei",
  },
};

const regionCensusLabels: CensusLabelSet = {
  cardTitles: {
    ethnicity: "Ethnicity",
    age: "Age Distribution",
    education: "Education Level",
    income: "Household Income",
    urbanization: "Urbanization",
  },
  ethnicity: {
    japanese: "Japanese",
    chinese: "Chinese",
    korean: "Korean",
    southeast_asian: "Southeast Asian",
    other_foreign: "Other Foreign",
  },
  age: {
    young: "Young (18-29)",
    mid: "Mid (30-44)",
    mature: "Mature (45-64)",
    senior: "Senior (65+)",
  },
  education: {
    high_school: "High School",
    vocational: "Vocational College",
    university: "University",
    graduate: "Graduate",
  },
  income: {
    low: "Lower income",
    middle: "Middle income",
    high: "Upper income",
  },
  urbanization: {
    urban: "Urban / city",
    suburban: "Suburban / town",
    rural: "Rural / village",
  },
};

/** Japan's eight regions, for the commodity map and region headers. */
const stateDisplayNames: Record<string, string> = {
  HOK: "Hokkaido",
  TOH: "Tohoku",
  KAN: "Kanto",
  CHU: "Chubu",
  KNS: "Kansai",
  CGK: "Chugoku",
  SHI: "Shikoku",
  KYU: "Kyushu & Okinawa",
};

/** NPC bank names, pre- and post-modernisation. */
const historicalNames: readonly string[] = ["Kanto Commercial Bank", "Osaka Harbour Trust"];
const modernNames: readonly string[] = [
  "Kanto Commercial Banking Group",
  "Osaka Harbour Financial",
];

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "日",
  command: "JOINT STAFF",
  strip: "◆ 機密 · ACTIVE THEATERS",
  acc: "#f0a0a0",
};

export const JP_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "Japan",
  cabinet,
  national,
  stats,
  treasuryText,
  economyText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
  parliamentarySurface,
  regionCensusLabels,
  stateDisplayNames,
  addressNames: { national: "Policy Speech" },
  historicalNames,
  modernNames,
};

/**
 * Chrome for Japan's military theatre display.
 *
 * Forwarded from `src/lib/military/theaters.ts`.
 */

/**
 * Bank of Japan identity text, for the institution header.
 *
 * Forwarded from `src/lib/constants/institutionIdentity.ts`, which composes it
 * with a palette to build the full `InstitutionIdentity`.
 *
 * ⚠ `titleEn` IS NOT DECORATION. `title` is rendered in Japanese and
 * `serif: "cjk"` selects the font that can display it; `titleEn` is what
 * non-Japanese surfaces fall back to. Dropping it leaves those surfaces with an
 * empty heading rather than an English one.
 */
export const JP_BANK_TEXT = {
  glyph: "¥",
  serif: "cjk" as const,
  registry: "Monetary Authority · Japan",
  title: "日本銀行",
  titleEn: "Bank of Japan",
};
