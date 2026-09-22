import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { CabinetIdentity } from "@/lib/constants/cabinetIdentity";
import type { EconomyIdentity } from "@/lib/constants/economyIdentity";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";

import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * Nigeria's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/ng.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts NG "Nigeria" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

/** The cabinet's page labels and glyph. */
const cabinet: CabinetIdentity = {
  glyph: "NG",
  serif: "mono",
  gov: "#0f8a4f",
  govSoft: "#57c98a",
  g0: "#06301c",
  g1: "#042214",
  g2: "#02160d",
};

const national: NationalIdentity = {
  glyph: "NG",
  serif: "mono",
  motif: "gear",
  name: "Nigeria National Corporation",
  native: "Nigeria National Enterprise",
  registry: "Federal Republic of Nigeria · State Asset Registry",
  ministry: "FEDERAL TREASURY",
  publicSeal: "PUBLIC REGISTER",
  hqCity: "Abuja",
  palette: ["#0d3527", "#0a261c", "#06150f"],
  accent: "#cdb15a",
  accentSoft: "#e2cd8c",
  accentName: "Naija green & gold",
};

/**
 * No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;
 * authoring that default here would make the fallback look chosen.
 */
// (stats is deliberately absent for NG.)

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "NG",
  serif: "mono",
  budgetTitle: "National Budget",
  ministry: "FEDERAL TREASURY",
  publicSeal: "PUBLIC RECORD",
  registry: "Federal Republic of Nigeria · Federal Treasury",
  native: "Federal Republic of Nigeria · Office of the Accountant-General",
};

/** The authored economy copy. The accent is pulled from `national` downstream. */
const economyText: Omit<EconomyIdentity, "accent"> = {
  glyph: "NG",
  serif: "mono",
  title: "Economic Outlook",
  titleEn: null,
  office: "National Bureau of Statistics · National Accounts",
  officeEn: "National Bureau of Statistics · National Accounts",
  registry: "Federal Republic of Nigeria · National Accounts Registry",
};

const executiveText: IdentityText = {
  glyph: "FG",
  serif: "mono",
  registry: "Federal Republic of Nigeria · Presidency",
  title: "Aso Rock Villa",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of National Law · Federal Republic of Nigeria",
  title: "National Policy",
};

/** The executive seal. */
const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Coat_of_arms_of_Nigeria.svg/330px-Coat_of_arms_of_Nigeria.svg.png",
  alt: "Coat of arms of Nigeria",
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
  heroImage: "/api/images/hero/aso-rock",
  heroAlt: "Aso Rock Presidential Villa, Abuja",
};

/**
 * No parliamentary executive surface. `SURFACES` has no NG entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for NG.)

/**
 * No census label set. `REGION_CENSUS_LABELS` has no NG entry and consumers
 * fall back to the generic labels -- the same text every unlisted country gets,
 * not NG data behind a NG-specific branch. Authoring one here would turn a
 * default into an authored value.
 */
// (regionCensusLabels is deliberately absent for NG.)

/**
 * No region display names. `STATE_DISPLAY_NAMES` has no NG entry; the map
 * falls back to `compactRegionCode(countryId, stateId)`, which derives from the
 * state id rather than naming anything. There is no value here to move.
 */
// (stateDisplayNames is deliberately absent for NG.)

/** NPC bank names, pre-modernisation. */
const historicalNames: readonly string[] = ["Niger Delta Trading Bank", "Savannah Merchants Bank"];

/** NPC bank names, post-modernisation. */
const modernNames: readonly string[] = ["Niger Delta Banking Group", "Savannah Financial"];

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "NG",
  command: "DEFENCE HEADQUARTERS",
  strip: "◆ RESTRICTED",
  acc: "#86d978",
};

export const NG_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "Nigeria",
  cabinet,
  national,
  treasuryText,
  economyText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
  historicalNames,
  modernNames,
};
