import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";

import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * Greece's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/gr.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts GR "Greece" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

/**
 * No CABINET_IDENTITY row. getCabinetIdentity falls back to its documented shell.
 */
// (cabinet is deliberately absent for GR.)

const national: NationalIdentity = {
  glyph: "ΕΔ",
  serif: "mono",
  motif: "laurel",
  name: "Hellenic State Enterprise",
  native: "Ελληνική Δημόσια Επιχείρηση",
  registry: "Hellenic Republic · State Holdings Registry",
  ministry: "MINISTRY OF FINANCE",
  publicSeal: "PUBLIC REGISTER",
  hqCity: "Athens",
  palette: ["#0d2a4a", "#0a1f38", "#06101c"],
  accent: "#3d8fd6",
  accentSoft: "#8ec2ea",
  accentName: "Aegean blue & white",
};

/**
 * No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;
 * authoring that default here would make the fallback look chosen.
 */
// (stats is deliberately absent for GR.)

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "ΕΔ",
  serif: "mono",
  budgetTitle: "State Budget",
  ministry: "MINISTRY OF FINANCE",
  publicSeal: "PUBLIC RECORD",
  registry: "Hellenic Republic · Ministry of Finance",
  native: "Ελληνική Δημοκρατία · Υπουργείο Οικονομικών",
};

/**
 * No ECONOMY_TEXT row. The reader falls back to DEFAULT_ECONOMY_TEXT.
 */
// (economyText is deliberately absent for GR.)

const executiveText: IdentityText = {
  glyph: "ΕΔ",
  serif: "mono",
  registry: "Hellenic Republic · Government",
  title: "Μέγαρο Μαξίμου",
  titleEn: "Maximos Mansion",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of Law · Hellenic Republic",
  title: "National Policy",
};

/** The executive seal. */
const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Coat_of_arms_of_Greece.svg/330px-Coat_of_arms_of_Greece.svg.png",
  alt: "Coat of arms of Greece",
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
  heroImage: "/api/images/hero/maximos-mansion",
  heroAlt: "Maximos Mansion, Athens",
};

/**
 * No parliamentary executive surface. `SURFACES` has no GR entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for GR.)

/**
 * No census label set. `REGION_CENSUS_LABELS` has no GR entry and consumers
 * fall back to the generic labels -- the same text every unlisted country gets,
 * not GR data behind a GR-specific branch. Authoring one here would turn a
 * default into an authored value.
 */
// (regionCensusLabels is deliberately absent for GR.)

/*
 * ⚠️ NO `stateDisplayNames` HERE, AND THAT IS THE POINT. This country's
 * display names are DERIVED at runtime in `commodityRegionMappings.ts` from
 * `grRegions`, under a comment that says "no hand-maintained copies to
 * drift". Snapshotting that derivation into the folder created exactly such
 * a copy: a frozen literal that would not follow a renamed or added region.
 * The rosters are the single source; the folder must not restate them.
 */

/** NPC bank names, pre-modernisation. */
const historicalNames: readonly string[] = ["Aegean Merchants Bank", "Peloponnese Savings Bank"];

/** NPC bank names, post-modernisation. */
const modernNames: readonly string[] = ["Aegean Banking Group", "Peloponnese Financial"];

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "GR",
  command: "ΓΕΝΙΚΟ ΕΠΙΤΕΛΕΙΟ",
  strip: "◆ ΑΠΟΡΡΗΤΟ",
  acc: "#9cc0f5",
};

export const GR_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "Greece",
  national,
  treasuryText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
  historicalNames,
  modernNames,
};
