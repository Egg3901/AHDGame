import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";

import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * France's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/fr.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts FR "France" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

/**
 * No CABINET_IDENTITY row. getCabinetIdentity falls back to its documented shell.
 */
// (cabinet is deliberately absent for FR.)

const national: NationalIdentity = {
  glyph: "RF",
  serif: "mono",
  motif: "gear",
  name: "French State Enterprise",
  native: "Entreprise Publique",
  registry: "French Republic · State Holdings Registry",
  ministry: "MINISTRY OF FINANCE",
  publicSeal: "PUBLIC REGISTER",
  hqCity: "Paris",
  palette: ["#0d1a3a", "#0a132a", "#060a15"],
  accent: "#c0c8e0",
  accentSoft: "#dde2f2",
  accentName: "Tricolore blue",
};

/**
 * No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;
 * authoring that default here would make the fallback look chosen.
 */
// (stats is deliberately absent for FR.)

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "RF",
  serif: "mono",
  budgetTitle: "State Budget",
  ministry: "MINISTRY OF ECONOMY AND FINANCE",
  publicSeal: "PUBLIC RECORD",
  registry: "French Republic · Ministry of Economy and Finance",
  native: "République française · Ministère de l'Économie et des Finances",
};

/**
 * No ECONOMY_TEXT row. The reader falls back to DEFAULT_ECONOMY_TEXT.
 */
// (economyText is deliberately absent for FR.)

const executiveText: IdentityText = {
  glyph: "RF",
  serif: "mono",
  registry: "French Republic · Presidency of the Republic",
  title: "Élysée Palace",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of Law · French Republic",
  title: "National Policy",
};

/** The executive seal. */
const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b7/Armoiries_république_française.svg/330px-Armoiries_république_française.svg.png",
  alt: "Arms of the French Republic",
};

const executiveSurface: ExecutiveSurfaceConfig = {
  clock: {
    kind: "election",
    label: "Term Clock",
    countdownNoun: "presidential election",
  },
  actLabels: {
    signed: "SIGNED",
    vetoed: "VETOED",
    onDesk: "ON DESK",
    order: "DECREE",
    confirmed: "CONFIRMED",
    nominated: "NOMINATED",
    acting: "ACTING",
  },
  deskKind: "bills",
  deskLabel: "The Desk",
  rosterTitle: "Government",
  heroImage: "/api/images/hero/elysee",
  heroAlt: "Élysée Palace, Paris",
};

/**
 * No parliamentary executive surface. `SURFACES` has no FR entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for FR.)

/**
 * No census label set. `REGION_CENSUS_LABELS` has no FR entry and consumers
 * fall back to the generic labels -- the same text every unlisted country gets,
 * not FR data behind a FR-specific branch. Authoring one here would turn a
 * default into an authored value.
 */
// (regionCensusLabels is deliberately absent for FR.)

/*
 * ⚠️ NO `stateDisplayNames` HERE, AND THAT IS THE POINT. This country's
 * display names are DERIVED at runtime in `commodityRegionMappings.ts` from
 * `frRegions`, under a comment that says "no hand-maintained copies to
 * drift". Snapshotting that derivation into the folder created exactly such
 * a copy: a frozen literal that would not follow a renamed or added region.
 * The rosters are the single source; the folder must not restate them.
 */

/** NPC bank names, pre-modernisation. */
const historicalNames: readonly string[] = ["Banque du Littoral", "Comptoir des Provinces"];

/** NPC bank names, post-modernisation. */
const modernNames: readonly string[] = ["Groupe Bancaire du Littoral", "Comptoir des Provinces"];

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "FR",
  command: "ÉTAT-MAJOR DES ARMÉES",
  strip: "◆ SECRET DÉFENSE",
  acc: "#9cc0f5",
};

export const FR_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "France",
  national,
  treasuryText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
  historicalNames,
  modernNames,
};
