import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";

import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * Finland's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/fi.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts FI "Finland" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

/**
 * No CABINET_IDENTITY row. getCabinetIdentity falls back to its documented shell.
 */
// (cabinet is deliberately absent for FI.)

const national: NationalIdentity = {
  glyph: "SV",
  serif: "mono",
  motif: "gear",
  name: "Finnish State Company",
  native: "Suomen Valtionyhtiö",
  registry: "Republic of Finland · State Holdings Registry",
  ministry: "MINISTRY OF FINANCE",
  publicSeal: "PUBLIC REGISTER",
  hqCity: "Helsinki",
  palette: ["#0d2038", "#0a1830", "#060d18"],
  accent: "#4a7fc0",
  accentSoft: "#93b8e0",
  accentName: "Nordic blue & white",
};

/**
 * No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;
 * authoring that default here would make the fallback look chosen.
 */
// (stats is deliberately absent for FI.)

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "VM",
  serif: "mono",
  budgetTitle: "State Budget",
  ministry: "MINISTRY OF FINANCE",
  publicSeal: "PUBLIC RECORD",
  registry: "Republic of Finland · Ministry of Finance",
  native: "Suomen Tasavalta · Valtiovarainministeriö",
};

/**
 * No ECONOMY_TEXT row. The reader falls back to DEFAULT_ECONOMY_TEXT.
 */
// (economyText is deliberately absent for FI.)

const executiveText: IdentityText = {
  glyph: "VN",
  serif: "mono",
  registry: "Republic of Finland · Council of State",
  title: "Valtioneuvosto",
  titleEn: "Government Palace",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of Law · Republic of Finland",
  title: "National Policy",
};

/** The executive seal. */
const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Coat_of_arms_of_Finland.svg/330px-Coat_of_arms_of_Finland.svg.png",
  alt: "Coat of arms of Finland",
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
  rosterTitle: "Council of State",
  heroImage: "/api/images/hero/government-palace-helsinki",
  heroAlt: "Government Palace, Helsinki",
};

/**
 * No parliamentary executive surface. `SURFACES` has no FI entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for FI.)

/**
 * No census label set. `REGION_CENSUS_LABELS` has no FI entry and consumers
 * fall back to the generic labels -- the same text every unlisted country gets,
 * not FI data behind a FI-specific branch. Authoring one here would turn a
 * default into an authored value.
 */
// (regionCensusLabels is deliberately absent for FI.)

/*
 * ⚠️ NO `stateDisplayNames` HERE, AND THAT IS THE POINT. This country's
 * display names are DERIVED at runtime in `commodityRegionMappings.ts` from
 * `fiRegions`, under a comment that says "no hand-maintained copies to
 * drift". Snapshotting that derivation into the folder created exactly such
 * a copy: a frozen literal that would not follow a renamed or added region.
 * The rosters are the single source; the folder must not restate them.
 */

/** NPC bank names, pre-modernisation. */
const historicalNames: readonly string[] = ["Lakeland Savings Bank", "Bothnia Commercial Bank"];

/** NPC bank names, post-modernisation. */
const modernNames: readonly string[] = ["Lakeland Financial", "Bothnia Banking Group"];

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "FI",
  command: "PÄÄESIKUNTA",
  strip: "◆ SALAINEN",
  acc: "#86d978",
};

export const FI_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "Finland",
  national,
  treasuryText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
  historicalNames,
  modernNames,
};
