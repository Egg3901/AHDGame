import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";

import type { CensusLabelSet } from "@/lib/constants/regionCensusLabels";
import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * Scotland's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/sco.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts SCO "Scotland" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

/**
 * No CABINET_IDENTITY row. getCabinetIdentity falls back to its documented shell.
 */
// (cabinet is deliberately absent for SCO.)

const national: NationalIdentity = {
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
};

/**
 * No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;
 * authoring that default here would make the fallback look chosen.
 */
// (stats is deliberately absent for SCO.)

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "AB",
  serif: "mono",
  budgetTitle: "Scottish Budget",
  ministry: "SCOTTISH GOVERNMENT",
  publicSeal: "PUBLIC RECORD",
  registry: "Scotland · Scottish Government Finance",
  native: "Scottish Government · Finance Directorate",
};

/**
 * No ECONOMY_TEXT row. The reader falls back to DEFAULT_ECONOMY_TEXT.
 */
// (economyText is deliberately absent for SCO.)

const executiveText: IdentityText = {
  glyph: "FM",
  serif: "mono",
  registry: "Scotland · Scottish Government",
  title: "Bute House",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Statute Book · Scotland",
  title: "National Policy",
};

/**
 * No EXECUTIVE_SEALS row. getSeal returns null, and the UI omits the seal.
 */
// (executiveSeal is deliberately absent for SCO.)

const executiveSurface: ExecutiveSurfaceConfig = {
  clock: {
    kind: "election",
    label: "Term Clock",
    countdownNoun: "next Holyrood election",
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
  heroImage: "/api/images/hero/bute-house",
  heroAlt: "Bute House, Edinburgh",
};

/**
 * No parliamentary executive surface. `SURFACES` has no SCO entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for SCO.)

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

/*
 * ⚠️ NO `stateDisplayNames`, AND THE VALUE THAT WAS HERE WAS NONSENSE.
 * The snapshot recorded `{ UK: "Scotland" }` for this country -- an
 * OUTER-KEYED slice, meaning the emitter found "SCO" as an INNER key of
 * `STATE_DISPLAY_NAMES.UK`. It is the United Kingdom's display name for its
 * SCO REGION, not Scotland's name for a region called "UK". The generator
 * wrote it straight into the folder, where it read as the latter.
 *
 * This is the SCO/WAL region-versus-country collision again, one layer down:
 * the same two ids that made every UK region file look multi-country. The
 * entry belongs to the UK's map and stays there.
 */

/**
 * No historical NPC bank names.
 */
// (historicalNames is deliberately absent for SCO.)

/**
 * No modern NPC bank names.
 */
// (modernNames is deliberately absent for SCO.)

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "SC",
  command: "DEFENCE STAFF",
  strip: "◆ RESTRICTED",
  acc: "#86d978",
};

export const SCO_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "Scotland",
  national,
  treasuryText,
  executiveText,
  policyText,
  executiveSurface,
  regionCensusLabels,
};
