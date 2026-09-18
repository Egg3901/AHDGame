import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";

import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * Czechoslovakia's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/cs.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts CS "Czechoslovakia" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

/**
 * No CABINET_IDENTITY row. getCabinetIdentity falls back to its documented shell.
 */
// (cabinet is deliberately absent for CS.)

const national: NationalIdentity = {
  glyph: "CS",
  serif: "mono",
  motif: "gearStar",
  name: "Czechoslovak State Enterprise",
  native: "Státní Podnik",
  registry: "Czechoslovak Socialist Republic · State Asset Registry",
  ministry: "STATE PLANNING COMMISSION",
  publicSeal: "PUBLIC REGISTER",
  hqCity: "Prague",
  palette: ["#1a2a3a", "#121f2a", "#0a1015"],
  accent: "#cdb15a",
  accentSoft: "#e2cd8c",
  accentName: "Czechoslovak blue & gold",
};

/**
 * No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;
 * authoring that default here would make the fallback look chosen.
 */
// (stats is deliberately absent for CS.)

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "CS",
  serif: "mono",
  budgetTitle: "State Plan Budget",
  ministry: "FEDERAL MINISTRY OF FINANCE",
  publicSeal: "PUBLIC RECORD",
  registry: "Czechoslovak Socialist Republic · Federal Ministry of Finance",
  native: "Československá socialistická republika · Federální ministerstvo financí",
};

/**
 * No ECONOMY_TEXT row. The reader falls back to DEFAULT_ECONOMY_TEXT.
 */
// (economyText is deliberately absent for CS.)

const executiveText: IdentityText = {
  glyph: "FV",
  serif: "mono",
  registry: "Czechoslovak Socialist Republic · Federal Government",
  title: "Federal Assembly",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of Law · Czechoslovak Socialist Republic",
  title: "National Policy",
};

/** The executive seal. */
const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/Coat_of_arms_of_Czechoslovakia_(1960-1990).svg/330px-Coat_of_arms_of_Czechoslovakia_(1960-1990).svg.png",
  alt: "Coat of arms of the Czechoslovak Socialist Republic",
};

const executiveSurface: ExecutiveSurfaceConfig = {
  clock: {
    kind: "plenum",
    label: "Plenum Clock",
    countdownNoun: "next Assembly session",
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
  rosterTitle: "Federal Government",
  heroImage: "/api/images/hero/czechoslovakia",
  heroAlt: "Federal Assembly, Prague",
};

/**
 * No parliamentary executive surface. `SURFACES` has no CS entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for CS.)

/**
 * No census label set. `REGION_CENSUS_LABELS` has no CS entry and consumers
 * fall back to the generic labels -- the same text every unlisted country gets,
 * not CS data behind a CS-specific branch. Authoring one here would turn a
 * default into an authored value.
 */
// (regionCensusLabels is deliberately absent for CS.)

/*
 * ⚠️ NO `stateDisplayNames` HERE, AND THAT IS THE POINT. This country's
 * display names are DERIVED at runtime in `commodityRegionMappings.ts` from
 * `csRegions`, under a comment that says "no hand-maintained copies to
 * drift". Snapshotting that derivation into the folder created exactly such
 * a copy: a frozen literal that would not follow a renamed or added region.
 * The rosters are the single source; the folder must not restate them.
 */

/**
 * No historical NPC bank names.
 */
// (historicalNames is deliberately absent for CS.)

/**
 * No modern NPC bank names.
 */
// (modernNames is deliberately absent for CS.)

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "CS",
  command: "GENERÁLNÍ ŠTÁB",
  strip: "◆ PŘÍSNĚ TAJNÉ",
  acc: "#f0a0a0",
};

export const CS_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "Czechoslovakia",
  national,
  treasuryText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
};
