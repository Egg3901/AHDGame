import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";

import type { CensusLabelSet } from "@/lib/constants/regionCensusLabels";
import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * Wales's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/wal.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts WAL "Wales" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

/**
 * No CABINET_IDENTITY row. getCabinetIdentity falls back to its documented shell.
 */
// (cabinet is deliberately absent for WAL.)

const national: NationalIdentity = {
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
};

/**
 * No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;
 * authoring that default here would make the fallback look chosen.
 */
// (stats is deliberately absent for WAL.)

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "CY",
  serif: "mono",
  budgetTitle: "Welsh Budget",
  ministry: "WELSH GOVERNMENT",
  publicSeal: "PUBLIC RECORD",
  registry: "Wales · Welsh Government Finance",
  native: "Welsh Government · Finance Directorate",
};

/**
 * No ECONOMY_TEXT row. The reader falls back to DEFAULT_ECONOMY_TEXT.
 */
// (economyText is deliberately absent for WAL.)

const executiveText: IdentityText = {
  glyph: "FM",
  serif: "mono",
  registry: "Wales · Welsh Government",
  title: "Welsh Government",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Statute Book · Wales",
  title: "National Policy",
};

/**
 * No EXECUTIVE_SEALS row. getSeal returns null, and the UI omits the seal.
 */
// (executiveSeal is deliberately absent for WAL.)

const executiveSurface: ExecutiveSurfaceConfig = {
  clock: {
    kind: "election",
    label: "Term Clock",
    countdownNoun: "next Senedd election",
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
  heroImage: "/api/images/hero/senedd",
  heroAlt: "Senedd, Cardiff",
};

/**
 * No parliamentary executive surface. `SURFACES` has no WAL entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for WAL.)

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
 * The snapshot recorded `{ UK: "Wales" }` for this country -- an
 * OUTER-KEYED slice, meaning the emitter found "WAL" as an INNER key of
 * `STATE_DISPLAY_NAMES.UK`. It is the United Kingdom's display name for its
 * WAL REGION, not Wales's name for a region called "UK". The generator
 * wrote it straight into the folder, where it read as the latter.
 *
 * This is the SCO/WAL region-versus-country collision again, one layer down:
 * the same two ids that made every UK region file look multi-country. The
 * entry belongs to the UK's map and stays there.
 */

/**
 * No historical NPC bank names.
 */
// (historicalNames is deliberately absent for WAL.)

/**
 * No modern NPC bank names.
 */
// (modernNames is deliberately absent for WAL.)

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "WA",
  command: "DEFENCE STAFF",
  strip: "◆ RESTRICTED",
  acc: "#86d978",
};

export const WAL_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "Wales",
  national,
  treasuryText,
  executiveText,
  policyText,
  executiveSurface,
  regionCensusLabels,
};
