import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";

import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * Bulgaria's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/bg.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts BG "Bulgaria" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

/**
 * No CABINET_IDENTITY row. getCabinetIdentity falls back to its documented shell.
 */
// (cabinet is deliberately absent for BG.)

const national: NationalIdentity = {
  glyph: "BG",
  serif: "mono",
  motif: "gearStar",
  name: "Bulgarian State Holdings",
  native: "Държавно Предприятие",
  registry: "People's Republic of Bulgaria · State Asset Registry",
  ministry: "STATE PLANNING COMMITTEE",
  publicSeal: "PUBLIC REGISTER",
  hqCity: "Sofia",
  palette: ["#0d3527", "#0a261c", "#06150f"],
  accent: "#cdb15a",
  accentSoft: "#e2cd8c",
  accentName: "Bulgarian green & gold",
};

/**
 * No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;
 * authoring that default here would make the fallback look chosen.
 */
// (stats is deliberately absent for BG.)

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "BG",
  serif: "mono",
  budgetTitle: "State Plan Budget",
  ministry: "MINISTRY OF FINANCE",
  publicSeal: "PUBLIC RECORD",
  registry: "People's Republic of Bulgaria · Ministry of Finance",
  native: "Народна република България · Министерство на финансите",
};

/**
 * No ECONOMY_TEXT row. The reader falls back to DEFAULT_ECONOMY_TEXT.
 */
// (economyText is deliberately absent for BG.)

const executiveText: IdentityText = {
  glyph: "MS",
  serif: "mono",
  registry: "People's Republic of Bulgaria · Council of Ministers",
  title: "National Assembly",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of Law · People's Republic of Bulgaria",
  title: "National Policy",
};

/** The executive seal. */
const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/25/Coat_of_arms_of_Bulgaria_(1971-1990).svg/330px-Coat_of_arms_of_Bulgaria_(1971-1990).svg.png",
  alt: "Coat of arms of the People's Republic of Bulgaria",
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
  rosterTitle: "Council of Ministers",
  heroImage: "/api/images/hero/bulgaria",
  heroAlt: "National Assembly, Sofia",
};

/**
 * No parliamentary executive surface. `SURFACES` has no BG entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for BG.)

/**
 * No census label set. `REGION_CENSUS_LABELS` has no BG entry and consumers
 * fall back to the generic labels -- the same text every unlisted country gets,
 * not BG data behind a BG-specific branch. Authoring one here would turn a
 * default into an authored value.
 */
// (regionCensusLabels is deliberately absent for BG.)

/*
 * ⚠️ NO `stateDisplayNames` HERE, AND THAT IS THE POINT. This country's
 * display names are DERIVED at runtime in `commodityRegionMappings.ts` from
 * `bgRegions`, under a comment that says "no hand-maintained copies to
 * drift". Snapshotting that derivation into the folder created exactly such
 * a copy: a frozen literal that would not follow a renamed or added region.
 * The rosters are the single source; the folder must not restate them.
 */

/**
 * No historical NPC bank names.
 */
// (historicalNames is deliberately absent for BG.)

/**
 * No modern NPC bank names.
 */
// (modernNames is deliberately absent for BG.)

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "BG",
  command: "ГЕНЕРАЛЕН ЩАБ",
  strip: "◆ СТРОГО СЕКРЕТНО",
  acc: "#f0a0a0",
};

export const BG_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "Bulgaria",
  national,
  treasuryText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
};
