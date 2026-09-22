import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { CabinetIdentity } from "@/lib/constants/cabinetIdentity";
import type { EconomyIdentity } from "@/lib/constants/economyIdentity";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";
import type { StatsIdentity } from "@/lib/constants/nationalStatsIdentity";
import type { CensusLabelSet } from "@/lib/constants/regionCensusLabels";
import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * China's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/cn.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts CN "China" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

const cabinet: CabinetIdentity = {
  glyph: "国",
  serif: "cjk",
  gov: "#d8b25e",
  govSoft: "#e7cd91",
  g0: "#4a1212",
  g1: "#2a0e0e",
  g2: "#160a0e",
};

const national: NationalIdentity = {
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
};

const stats: StatsIdentity = {
  glyph: "统",
  serif: "cjk",
  office: "国家统计局",
  officeEn: "National Bureau of Statistics",
  title: "国家统计 (National Statistics)",
  titleEn: "National Statistics",
  registry: "People's Republic of China · National Bureau of Statistics",
  seal: "统计局 · NBS",
  accent: {
    stat: "#d8b25e",
    statSoft: "#e7cd91",
    g0: "#4a1212",
    g1: "#2a0e0e",
    g2: "#160a0e",
  },
};

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "财",
  serif: "cjk",
  budgetTitle: "国家预算",
  budgetTitleEn: "National Budget",
  ministry: "财政部 · MOF",
  publicSeal: "公开 · PUBLIC",
  registry: "People's Republic of China · Ministry of Finance",
  native: "中华人民共和国 · 财政部",
  nativeEn: "People's Republic of China · Ministry of Finance",
};

const economyText: Omit<EconomyIdentity, "accent"> = {
  glyph: "经",
  serif: "cjk",
  title: "国民经济展望",
  titleEn: "Economic Outlook",
  office: "国家统计局 · 国民经济核算司",
  officeEn: "National Accounts Office",
  registry: "People's Republic of China · National Accounts Registry",
};

const executiveText: IdentityText = {
  glyph: "政",
  serif: "cjk",
  registry: "People's Republic of China · Executive Organs",
  title: "国务院",
  titleEn: "State Council & Government",
};

const policyText: IdentityText = {
  glyph: "法",
  serif: "cjk",
  registry: "Code of National Law · People's Republic of China",
  title: "国家法律",
  titleEn: "National Policy",
};

const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/National_Emblem_of_the_People%27s_Republic_of_China.svg/330px-National_Emblem_of_the_People%27s_Republic_of_China.svg.png",
  alt: "National Emblem of the People's Republic of China",
};

const executiveSurface: ExecutiveSurfaceConfig = {
  clock: {
    kind: "plenum",
    label: "Plenum Clock",
    countdownNoun: "next NPC session",
  },
  actLabels: {
    signed: "ENACTED",
    vetoed: "REJECTED",
    onDesk: "AWAITING",
    order: "DIRECTIVE",
    confirmed: "APPOINTED",
    nominated: "NOMINATED",
    acting: "ACTING",
  },
  deskKind: "orders",
  deskLabel: "Directives",
  rosterTitle: "State Council",
  heroImage: "/api/images/hero/zhongnanhai",
  heroAlt: "Zhongnanhai, Beijing",
};

/**
 * No parliamentary executive surface. `SURFACES` has no CN entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for CN.)

/** Census category labels for region pages. */
const regionCensusLabels: CensusLabelSet = {
  cardTitles: {
    ethnicity: "Ethnicity",
    age: "Age Distribution",
    education: "Education (Highest)",
    income: "Household Income",
    urbanization: "Urbanization",
  },
  ethnicity: {
    han: "Han",
    zhuang: "Zhuang",
    hui: "Hui",
    uyghur: "Uyghur",
    tibetan: "Tibetan",
    other_minority: "Other minority",
  },
  age: {
    young: "Young (18-29)",
    mid: "Mid (30-44)",
    mature: "Mature (45-64)",
    senior: "Senior (65+)",
  },
  education: {
    primary_or_below: "Primary or below",
    secondary: "Secondary",
    vocational: "Vocational",
    university: "University",
  },
  income: {
    low: "Lower income",
    middle: "Middle income",
    high: "Upper income",
  },
  urbanization: {
    urban: "Urban",
    suburban: "County town",
    rural: "Rural",
  },
};

/** Region display names (STATE_DISPLAY_NAMES), used by the commodity map. */
const stateDisplayNames: Record<string, string> = {
  DB: "Dongbei",
  HB: "Huabei",
  HD: "Huadong",
  HZ: "Huazhong",
  HN: "Huanan",
  XN: "Xinan",
  XB: "Xibei",
};

/**
 * No historical NPC bank names.
 */
// (historicalNames is deliberately absent for CN.)

/**
 * No modern NPC bank names.
 */
// (modernNames is deliberately absent for CN.)

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "中",
  command: "CENTRAL MILITARY COMMISSION",
  strip: "◆ 机密",
  acc: "#e0b352",
};

export const CN_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "China",
  cabinet,
  national,
  stats,
  treasuryText,
  economyText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
  regionCensusLabels,
  stateDisplayNames,
};
