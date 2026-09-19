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
 * United Kingdom's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/uk.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts UK "United Kingdom" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

const cabinet: CabinetIdentity = {
  glyph: "UK",
  serif: "mono",
  gov: "#c9a24b",
  govSoft: "#e1c382",
  g0: "#16233f",
  g1: "#101a30",
  g2: "#0c1018",
};

const national: NationalIdentity = {
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
};

const stats: StatsIdentity = {
  glyph: "ONS",
  serif: "mono",
  office: "Office for National Statistics",
  officeEn: "Office for National Statistics",
  title: "National Statistics",
  titleEn: null,
  registry: "United Kingdom · Office for National Statistics",
  seal: "UK ONS",
  accent: {
    stat: "#c9a24b",
    statSoft: "#e1c382",
    g0: "#16233f",
    g1: "#101a30",
    g2: "#0c1018",
  },
};

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "HM",
  serif: "mono",
  budgetTitle: "HM Treasury Budget",
  ministry: "HM TREASURY",
  publicSeal: "PUBLIC RECORD",
  registry: "United Kingdom · HM Treasury",
  native: "His Majesty's Treasury",
};

const economyText: Omit<EconomyIdentity, "accent"> = {
  glyph: "UK",
  serif: "mono",
  title: "Economic Outlook",
  titleEn: null,
  office: "Office for National Statistics · Economic Accounts",
  officeEn: "Office for National Statistics · Economic Accounts",
  registry: "United Kingdom · National Accounts Registry",
};

const executiveText: IdentityText = {
  glyph: "HM",
  serif: "mono",
  registry: "United Kingdom · His Majesty's Government",
  title: "10 Downing Street",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Statute Book · United Kingdom",
  title: "National Policy",
};

const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28St_Edwards_Crown%29.svg/330px-Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28St_Edwards_Crown%29.svg.png",
  alt: "Royal Arms of His Majesty's Government",
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
    order: "ORDER IN COUNCIL",
    confirmed: "APPOINTED",
    nominated: "NOMINATED",
    acting: "ACTING",
  },
  deskKind: "orders",
  deskLabel: "Orders in Force",
  rosterTitle: "Cabinet",
  heroImage: "/api/images/hero/downing-street",
  heroAlt: "10 Downing Street, London",
};

/** The PARLIAMENTARY surface. `onePartyExecutiveSurface.ts` declares a symbol of the same name that is a different thing. */
const parliamentarySurface: ParliamentaryExecutiveSurface = {
  executiveTitle: "Prime Minister",
  memberLabel: "MP",
  headPlaque: {
    title: "Prime Minister",
    sealGlyph: "PM",
    vacancyNote: "A qualifying party or coalition chair may nominate a Prime Minister.",
  },
  oppositionPlaque: {
    title: "Leader of the Opposition",
    sealGlyph: "LO",
    vacancyNote: "The leader of the largest opposition party in the Commons.",
  },
  seatsPanel: {
    title: "Commons seats by party",
    emptyText: "No Commons MPs elected yet.",
  },
  hero: {
    image: "/api/images/hero/downing-street",
    alt: "10 Downing Street",
    title: null,
    tagline: "10 Downing Street · Prime Minister, Cabinet, and the House of Commons",
    breadcrumbLast: "Downing Street",
  },
  heroTitleUsesImperialPossessive: true,
};

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
    white_british: "White British / Irish",
    asian_british: "Asian British",
    black_british: "Black British",
    mixed: "Mixed",
    other: "Other",
  },
  age: {
    young: "Young (18-29)",
    mid: "Mid (30-44)",
    mature: "Mature (45-64)",
    senior: "Senior (65+)",
  },
  education: {
    no_qualifications: "No qualifications",
    gcse_equivalent: "GCSE / Level 2",
    a_level_equivalent: "A-Level / Level 3",
    degree_plus: "Degree or higher",
  },
  income: {
    low: "Lower income",
    middle: "Middle income",
    high: "Upper income",
  },
  urbanization: {
    urban: "Urban conurbation",
    suburban: "Suburban / town",
    rural: "Rural / village",
  },
};

/** Region display names (STATE_DISPLAY_NAMES), used by the commodity map. */
const stateDisplayNames: Record<string, string> = {
  LON: "London",
  SEE: "South East",
  SWE: "South West",
  EAE: "East of England",
  EMI: "East Midlands",
  WMI: "West Midlands",
  YHU: "Yorkshire",
  NWE: "North West",
  NEE: "North East",
  SCO: "Scotland",
  WAL: "Wales",
  NIR: "N. Ireland",
};

/** NPC bank names, pre-modernisation. */
const historicalNames: readonly string[] = ["Midland Counties Bank", "Clydeside Mercantile Bank"];

/** NPC bank names, post-modernisation. */
const modernNames: readonly string[] = ["Midland Counties Banking Group", "Clydeside Financial"];

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "UK",
  command: "DEFENCE STAFF",
  strip: "◆ UK EYES ONLY · ACTIVE THEATERS",
  acc: "#9cc0f5",
};

export const UK_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "United Kingdom",
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
  addressNames: { national: "Address to the Nation" },
};
