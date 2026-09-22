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
 * Germany's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/de.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts DE "Germany" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

const cabinet: CabinetIdentity = {
  glyph: "DE",
  serif: "mono",
  gov: "#d4a244",
  govSoft: "#e8c884",
  g0: "#2a2218",
  g1: "#1a150d",
  g2: "#100c07",
};

const national: NationalIdentity = {
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
};

const stats: StatsIdentity = {
  glyph: "DES",
  serif: "mono",
  office: "Statistisches Bundesamt",
  officeEn: "Federal Statistical Office",
  title: "Bundesstatistik (Federal Statistics)",
  titleEn: "Federal Statistics",
  registry: "Federal Republic of Germany · Statistisches Bundesamt",
  seal: "DESTATIS",
  accent: {
    stat: "#d4a244",
    statSoft: "#e8c884",
    g0: "#2a2218",
    g1: "#1a150d",
    g2: "#100c07",
  },
};

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "BU",
  serif: "mono",
  budgetTitle: "Bundeshaushalt",
  budgetTitleEn: "Federal Budget",
  ministry: "BMF · FINANZEN",
  publicSeal: "ÖFFENTLICH · PUBLIC",
  registry: "Federal Republic of Germany · Federal Ministry of Finance",
  native: "Bundesrepublik Deutschland · Bundesfinanzministerium",
  nativeEn: "Federal Republic of Germany · Federal Ministry of Finance",
};

const economyText: Omit<EconomyIdentity, "accent"> = {
  glyph: "DE",
  serif: "mono",
  title: "Wirtschaftsausblick",
  titleEn: "Economic Outlook",
  office: "Statistisches Bundesamt · Volkswirtschaftliche Gesamtrechnungen",
  officeEn: "Federal Statistical Office · National Accounts",
  registry: "Federal Republic of Germany · National Accounts Registry",
};

const executiveText: IdentityText = {
  glyph: "BK",
  serif: "mono",
  registry: "Federal Republic of Germany · Federal Government",
  title: "Bundeskanzleramt",
  titleEn: "Federal Chancellery",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of National Law · Federal Republic of Germany",
  title: "Bundesrecht",
  titleEn: "National Policy",
};

const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Bundesadler_Bundesorgane.svg/330px-Bundesadler_Bundesorgane.svg.png",
  alt: "Federal eagle of Germany",
};

const executiveSurface: ExecutiveSurfaceConfig = {
  clock: {
    kind: "election",
    label: "Term Clock",
    countdownNoun: "next federal election",
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
  heroImage: "/api/images/hero/reichstag",
  heroAlt: "Reichstag building, Berlin",
};

/** The PARLIAMENTARY surface. `onePartyExecutiveSurface.ts` declares a symbol of the same name that is a different thing. */
const parliamentarySurface: ParliamentaryExecutiveSurface = {
  executiveTitle: "Chancellor",
  memberLabel: "Bundestag member",
  headPlaque: {
    title: "Chancellor",
    sealGlyph: "BK",
    vacancyNote: "A qualifying party or coalition chair may nominate a Chancellor.",
  },
  oppositionPlaque: {
    title: "Opposition Leader",
    sealGlyph: "OP",
    vacancyNote: "The leader of the largest opposition bloc in the Bundestag.",
  },
  seatsPanel: {
    title: "Bundestag seats by party",
    emptyText: "No Bundestag members elected yet.",
  },
  hero: {
    image: "/api/images/hero/reichstag",
    alt: "Bundeskanzleramt and Reichstag in Berlin",
    title: "Federal Government of Germany",
    tagline: "Bundeskanzleramt · Chancellor, cabinet, and Bundestag confidence",
    breadcrumbLast: "Federal Chancellery",
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
    german: "German (no migration background)",
    turkish_russian_diaspora: "Turkish / Russian-German",
    mena: "MENA",
    eu_southern_eastern: "EU Southern / Eastern",
    other: "Other",
  },
  age: {
    young: "Young (18-29)",
    mid: "Mid (30-44)",
    mature: "Mature (45-64)",
    senior: "Senior (65+)",
  },
  education: {
    no_degree: "No / Hauptschule",
    berufsausbildung: "Vocational (Lehre)",
    abitur: "Abitur / Fachhochschulreife",
    hochschulabschluss: "University degree",
  },
  income: {
    low: "Lower income",
    middle: "Middle income",
    high: "Upper income",
  },
  urbanization: {
    urban: "Urban",
    suburban: "Suburban / town",
    rural: "Rural",
  },
};

/** Region display names (STATE_DISPLAY_NAMES), used by the commodity map. */
const stateDisplayNames: Record<string, string> = {
  NW: "North Rhine-Westphalia",
  BY: "Bavaria",
  BW: "Baden-Württemberg",
  NI: "Lower Saxony",
  HE: "Hesse",
  SN: "Saxony",
  RP: "Rhineland-Palatinate",
  ST: "Saxony-Anhalt",
  SH: "Schleswig-Holstein",
  TH: "Thuringia",
  BB: "Brandenburg",
  MV: "Mecklenburg-Vorpommern",
  SL: "Saarland",
  BE: "Berlin",
  HH: "Hamburg",
  BRE: "Bremen",
};

/** NPC bank names, pre-modernisation. */
const historicalNames: readonly string[] = ["Rhineland Credit Bank", "Hanseatic Merchants Bank"];

/** NPC bank names, post-modernisation. */
const modernNames: readonly string[] = ["Rhineland Credit Group", "Hanseatic Banking Group"];

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "DE",
  command: "BUNDESWEHR COMMAND",
  strip: "◆ NUR FÜR DEN DIENSTGEBRAUCH",
  acc: "#d4af37",
};

export const DE_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "Germany",
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
  addressNames: { national: "Government Declaration" },
};
