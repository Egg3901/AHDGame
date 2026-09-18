import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";

import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * Sweden's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/se.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts SE "Sweden" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

/**
 * No CABINET_IDENTITY row. getCabinetIdentity falls back to its documented shell.
 */
// (cabinet is deliberately absent for SE.)

const national: NationalIdentity = {
  glyph: "SE",
  serif: "mono",
  motif: "gear",
  name: "Swedish State Enterprise",
  native: "Statligt Bolag",
  registry: "Kingdom of Sweden · State Holdings Registry",
  ministry: "MINISTRY OF FINANCE",
  publicSeal: "PUBLIC REGISTER",
  hqCity: "Stockholm",
  palette: ["#0d2540", "#0a1c30", "#06101c"],
  accent: "#f5c542",
  accentSoft: "#ffe08a",
  accentName: "Swedish blue & yellow",
};

/**
 * No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;
 * authoring that default here would make the fallback look chosen.
 */
// (stats is deliberately absent for SE.)

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "SE",
  serif: "mono",
  budgetTitle: "State Budget",
  ministry: "MINISTRY OF FINANCE",
  publicSeal: "PUBLIC RECORD",
  registry: "Kingdom of Sweden · Ministry of Finance",
  native: "Konungariket Sverige · Finansdepartementet",
};

/**
 * No ECONOMY_TEXT row. The reader falls back to DEFAULT_ECONOMY_TEXT.
 */
// (economyText is deliberately absent for SE.)

const executiveText: IdentityText = {
  glyph: "SE",
  serif: "mono",
  registry: "Kingdom of Sweden · Government Offices",
  title: "Rosenbad",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of Law · Kingdom of Sweden",
  title: "National Policy",
};

/** The executive seal. */
const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Great_coat_of_arms_of_Sweden.svg/330px-Great_coat_of_arms_of_Sweden.svg.png",
  alt: "Greater coat of arms of Sweden",
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
  deskKind: "bills",
  deskLabel: "The Desk",
  rosterTitle: "Cabinet",
  heroImage: "/api/images/hero/rosenbad",
  heroAlt: "Rosenbad, Stockholm",
};

/**
 * No parliamentary executive surface. `SURFACES` has no SE entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for SE.)

/**
 * No census label set. `REGION_CENSUS_LABELS` has no SE entry and consumers
 * fall back to the generic labels -- the same text every unlisted country gets,
 * not SE data behind a SE-specific branch. Authoring one here would turn a
 * default into an authored value.
 */
// (regionCensusLabels is deliberately absent for SE.)

/*
 * ⚠️ NO `stateDisplayNames` HERE, AND THAT IS THE POINT. This country's
 * display names are DERIVED at runtime in `commodityRegionMappings.ts` from
 * `seRegions`, under a comment that says "no hand-maintained copies to
 * drift". Snapshotting that derivation into the folder created exactly such
 * a copy: a frozen literal that would not follow a renamed or added region.
 * The rosters are the single source; the folder must not restate them.
 */

/** NPC bank names, pre-modernisation. */
const historicalNames: readonly string[] = ["Svea Merchants Bank", "Norrland Savings Bank"];

/** NPC bank names, post-modernisation. */
const modernNames: readonly string[] = ["Svea Banking Group", "Norrland Financial"];

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "SE",
  command: "FÖRSVARSMAKTEN",
  strip: "◆ HEMLIG",
  acc: "#86d978",
};

export const SE_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "Sweden",
  national,
  treasuryText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
  historicalNames,
  modernNames,
};
