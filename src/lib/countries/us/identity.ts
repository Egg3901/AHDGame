import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { CabinetIdentity } from "@/lib/constants/cabinetIdentity";
import type { EconomyIdentity } from "@/lib/constants/economyIdentity";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";
import type { StatsIdentity } from "@/lib/constants/nationalStatsIdentity";
import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * United States's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/us.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts US "United States" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

const cabinet: CabinetIdentity = {
  glyph: "US",
  serif: "mono",
  gov: "#b9933f",
  govSoft: "#d9b970",
  g0: "#1b2747",
  g1: "#121b33",
  g2: "#0b0f1c",
};

const national: NationalIdentity = {
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
};

const stats: StatsIdentity = {
  glyph: "US",
  serif: "mono",
  office: "Bureau of Economic Analysis",
  officeEn: "Bureau of Economic Analysis",
  title: "Federal Statistics",
  titleEn: null,
  registry: "United States · Bureau of Economic Analysis",
  seal: "U.S. BEA",
  accent: {
    stat: "#b9933f",
    statSoft: "#d9b970",
    g0: "#1b2747",
    g1: "#121b33",
    g2: "#0b0f1c",
  },
};

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "US",
  serif: "mono",
  budgetTitle: "Federal Budget",
  ministry: "U.S. TREASURY",
  publicSeal: "PUBLIC RECORD",
  registry: "United States · Department of the Treasury",
  native: "Department of the Treasury",
};

const economyText: Omit<EconomyIdentity, "accent"> = {
  glyph: "US",
  serif: "mono",
  title: "Economic Outlook",
  titleEn: null,
  office: "Bureau of National Accounts",
  officeEn: "Bureau of National Accounts",
  registry: "United States · National Accounts Registry",
};

const executiveText: IdentityText = {
  glyph: "★",
  serif: "mono",
  registry: "Executive Office of the President",
  title: "The White House",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of National Law · United States",
  title: "National Policy",
};

const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Seal_of_the_President_of_the_United_States.svg/330px-Seal_of_the_President_of_the_United_States.svg.png",
  alt: "Seal of the President of the United States",
};

const executiveSurface: ExecutiveSurfaceConfig = {
  clock: {
    kind: "election",
    label: "Term Clock",
    countdownNoun: "election",
  },
  actLabels: {
    signed: "SIGNED",
    vetoed: "VETOED",
    onDesk: "ON DESK",
    order: "EX. ORDER",
    confirmed: "CONFIRMED",
    nominated: "NOMINATED",
    acting: "ACTING",
  },
  deskKind: "bills",
  deskLabel: "The Desk",
  rosterTitle: "Cabinet",
  heroImage: "/api/images/hero/white-house",
  heroAlt: "The White House, Washington D.C.",
};

/**
 * No parliamentary executive surface. `SURFACES` has no US entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for US.)

/**
 * No census label set. `REGION_CENSUS_LABELS` has no US entry and consumers
 * fall back to the generic labels -- the same text every unlisted country gets,
 * not US data behind a US-specific branch. Authoring one here would turn a
 * default into an authored value.
 */
// (regionCensusLabels is deliberately absent for US.)

/**
 * No region display names. `STATE_DISPLAY_NAMES` has no US entry; the map
 * falls back to `compactRegionCode(countryId, stateId)`, which derives from the
 * state id rather than naming anything. There is no value here to move.
 */
// (stateDisplayNames is deliberately absent for US.)

/** NPC bank names, pre-modernisation. */
const historicalNames: readonly string[] = [
  "Continental Merchants Bank",
  "Prairie States Savings Bank",
];

/** NPC bank names, post-modernisation. */
const modernNames: readonly string[] = [
  "Continental Merchants Bancorp",
  "Prairie States Financial",
];

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "US",
  command: "JOINT CHIEFS OF STAFF",
  strip: "◆ EYES ONLY · ACTIVE THEATERS",
  acc: "#9cc0f5",
};

export const US_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "United States",
  cabinet,
  national,
  stats,
  treasuryText,
  economyText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
  historicalNames,
  modernNames,
  addressNames: { national: "State of the Union" },
};
