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
 * Ireland's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/ie.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts IE "Ireland" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

const cabinet: CabinetIdentity = {
  glyph: "IE",
  serif: "mono",
  gov: "#cba24b",
  govSoft: "#e4c886",
  g0: "#123022",
  g1: "#0d2017",
  g2: "#08130d",
};

const national: NationalIdentity = {
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
};

const stats: StatsIdentity = {
  glyph: "CSO",
  serif: "mono",
  office: "An Phríomh-Oifig Staidrimh",
  officeEn: "Central Statistics Office",
  title: "Staidreamh Náisiúnta (National Statistics)",
  titleEn: "National Statistics",
  registry: "Ireland · Central Statistics Office",
  seal: "CSO · IE",
  accent: {
    stat: "#cba24b",
    statSoft: "#e4c886",
    g0: "#123022",
    g1: "#0d2017",
    g2: "#08130d",
  },
};

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "ÉN",
  serif: "mono",
  budgetTitle: "Buiséad Náisiúnta",
  budgetTitleEn: "National Budget",
  ministry: "AN ROINN · FINANCE",
  publicSeal: "POIBLÍ · PUBLIC",
  registry: "Ireland · Department of Finance",
  native: "Éire · An Roinn Airgeadais",
  nativeEn: "Ireland · Department of Finance",
};

const economyText: Omit<EconomyIdentity, "accent"> = {
  glyph: "ÉI",
  serif: "mono",
  title: "Ionchas Eacnamaíochta",
  titleEn: "Economic Outlook",
  office: "An Phríomh-Oifig Staidrimh · Cuntais Náisiúnta",
  officeEn: "Central Statistics Office · National Accounts",
  registry: "Ireland · National Accounts Registry",
};

const executiveText: IdentityText = {
  glyph: "DT",
  serif: "mono",
  registry: "Ireland · Government of Ireland",
  title: "Tithe an Rialtais",
  titleEn: "Government Buildings",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of National Law · Ireland",
  title: "National Policy",
};

const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fe/Coat_of_arms_of_Ireland.svg/330px-Coat_of_arms_of_Ireland.svg.png",
  alt: "Coat of arms of Ireland",
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
  heroImage: "/api/images/hero/government-buildings-dublin",
  heroAlt: "Government Buildings, Dublin",
};

/** The PARLIAMENTARY surface. `onePartyExecutiveSurface.ts` declares a symbol of the same name that is a different thing. */
const parliamentarySurface: ParliamentaryExecutiveSurface = {
  executiveTitle: "Taoiseach",
  memberLabel: "TD",
  headPlaque: {
    title: "Taoiseach",
    sealGlyph: "T",
    vacancyNote: "A qualifying party or coalition chair may nominate a Taoiseach.",
  },
  deputyPlaque: {
    title: "Tánaiste",
    sealGlyph: "Tá",
    vacancyNote: "The Taoiseach nominates a Tánaiste from cabinet ministers.",
    cabinetPositionId: "tanaiste",
  },
  oppositionPlaque: {
    title: "Opposition Leader",
    sealGlyph: "FC",
    vacancyNote: "The leader of the largest opposition bloc in the Dáil.",
  },
  seatsPanel: {
    title: "Dáil seats by party",
    emptyText: "No TDs elected yet.",
  },
  hero: {
    image: "https://flagcdn.com/w640/ie.png",
    alt: "Government Buildings, Merrion Street, Dublin",
    title: "Government of Ireland",
    tagline: "Tithe an Rialtais · Taoiseach, Cabinet, and Dáil confidence",
    breadcrumbLast: "Government Buildings",
  },
};

/** Census category labels for region pages. */
const regionCensusLabels: CensusLabelSet = {
  cardTitles: {
    ethnicity: "Ethnicity / Background",
    age: "Age Distribution",
    education: "Education (Highest)",
    income: "Household Income",
    urbanization: "Urbanization",
  },
  ethnicity: {
    irish: "Irish",
    uk_british: "UK / British",
    eu_other: "Other EU",
    rest_of_world: "Rest of world",
  },
  age: {
    young: "Young (18-29)",
    mid: "Mid (30-44)",
    mature: "Mature (45-64)",
    senior: "Senior (65+)",
  },
  education: {
    primary_or_less: "Primary or less",
    leaving_cert: "Leaving Certificate",
    post_secondary: "Post-secondary / PLC",
    third_level: "Third-level degree",
  },
  income: {
    low: "Lower income",
    middle: "Middle income",
    high: "Upper income",
  },
  urbanization: {
    urban: "City / urban",
    suburban: "Town",
    rural: "Rural",
  },
};

/** Region display names (STATE_DISPLAY_NAMES), used by the commodity map. */
const stateDisplayNames: Record<string, string> = {
  DUB: "Dublin",
  KIL: "Kildare",
  MID: "Midlands",
  LIM: "Limerick",
  COR: "Cork",
  WEX: "Wexford",
  GAL: "Galway",
  DON: "Donegal",
};

/** NPC bank names, pre-modernisation. */
const historicalNames: readonly string[] = ["Hibernian Provincial Bank", "Shannon Valley Bank"];

/** NPC bank names, post-modernisation. */
const modernNames: readonly string[] = ["Hibernian Banking Group", "Shannon Valley Financial"];

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "IE",
  command: "DEFENCE FORCES HQ",
  strip: "◆ RESTRICTED",
  acc: "#86d978",
};

export const IE_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "Ireland",
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
  historicalNames,
  modernNames,
  addressNames: { national: "Address to the Oireachtas" },
};
