import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { CabinetIdentity } from "@/lib/constants/cabinetIdentity";

import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";

import type { CensusLabelSet } from "@/lib/constants/regionCensusLabels";
import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * East Germany's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/dd.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts DD "East Germany" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

const cabinet: CabinetIdentity = {
  glyph: "DDR",
  serif: "mono",
  gov: "#d9a93e",
  govSoft: "#eccb7d",
  g0: "#4d0f0f",
  g1: "#320b0b",
  g2: "#1a0707",
};

const national: NationalIdentity = {
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
};

/**
 * No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;
 * authoring that default here would make the fallback look chosen.
 */
// (stats is deliberately absent for DD.)

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "DDR",
  serif: "mono",
  budgetTitle: "State Plan Budget",
  ministry: "MINISTRY OF FINANCE",
  publicSeal: "PUBLIC RECORD",
  registry: "German Democratic Republic · Ministry of Finance",
  native: "Deutsche Demokratische Republik · Ministerium der Finanzen",
};

/**
 * No ECONOMY_TEXT row. The reader falls back to DEFAULT_ECONOMY_TEXT.
 */
// (economyText is deliberately absent for DD.)

const executiveText: IdentityText = {
  glyph: "DDR",
  serif: "mono",
  registry: "German Democratic Republic · Council of Ministers",
  title: "Altes Stadthaus",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of Law · German Democratic Republic",
  title: "National Policy",
};

const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Coat_of_arms_of_East_Germany.svg/330px-Coat_of_arms_of_East_Germany.svg.png",
  alt: "Coat of arms of East Germany (GDR)",
};

const executiveSurface: ExecutiveSurfaceConfig = {
  clock: {
    kind: "plenum",
    label: "Plenum Clock",
    countdownNoun: "next Volkskammer session",
  },
  actLabels: {
    signed: "ENACTED",
    vetoed: "REJECTED",
    onDesk: "AWAITING",
    order: "DECREE",
    confirmed: "APPOINTED",
    nominated: "NOMINATED",
    acting: "ACTING",
  },
  deskKind: "orders",
  deskLabel: "Decrees",
  rosterTitle: "Council of Ministers",
  heroImage: "/api/images/hero/altes-stadthaus",
  heroAlt: "Altes Stadthaus, Berlin",
};

/**
 * No parliamentary executive surface. `SURFACES` has no DD entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for DD.)

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
    german: "German",
    other: "Other",
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
    suburban: "Suburban / town",
    rural: "Rural",
  },
};

/**
 * No region display names. `STATE_DISPLAY_NAMES` has no DD entry; the map
 * falls back to `compactRegionCode(countryId, stateId)`, which derives from the
 * state id rather than naming anything. There is no value here to move.
 */
// (stateDisplayNames is deliberately absent for DD.)

/**
 * No historical NPC bank names.
 */
// (historicalNames is deliberately absent for DD.)

/**
 * No modern NPC bank names.
 */
// (modernNames is deliberately absent for DD.)

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "DD",
  command: "NATIONALE VOLKSARMEE",
  strip: "◆ VERTRAULICHE VERSCHLUSSSACHE",
  acc: "#f0a0a0",
};

export const DD_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "East Germany",
  cabinet,
  national,
  treasuryText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
  regionCensusLabels,
};
