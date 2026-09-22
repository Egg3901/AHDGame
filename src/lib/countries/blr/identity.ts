import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";

import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * Belarus's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/blr.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts BLR "Belarus" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

/**
 * No CABINET_IDENTITY row. getCabinetIdentity falls back to its documented shell.
 */
// (cabinet is deliberately absent for BLR.)

const national: NationalIdentity = {
  glyph: "BLR",
  serif: "mono",
  motif: "gearStar",
  name: "Byelorussian State Enterprise",
  native: "Дзяржаўнае Прадпрыемства",
  registry: "Byelorussian SSR · State Asset Registry",
  ministry: "GOSPLAN",
  publicSeal: "PUBLIC REGISTER",
  hqCity: "Minsk",
  palette: ["#3a0d0d", "#2a0a0a", "#150606"],
  accent: "#cdb15a",
  accentSoft: "#e2cd8c",
  accentName: "Soviet red & gold",
};

/**
 * No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;
 * authoring that default here would make the fallback look chosen.
 */
// (stats is deliberately absent for BLR.)

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "BLR",
  serif: "mono",
  budgetTitle: "State Plan Budget",
  ministry: "MINISTRY OF FINANCE",
  publicSeal: "PUBLIC RECORD",
  registry: "Byelorussian SSR · Ministry of Finance",
  native: "Беларуская ССР · Міністэрства фінансаў",
};

/**
 * No ECONOMY_TEXT row. The reader falls back to DEFAULT_ECONOMY_TEXT.
 */
// (economyText is deliberately absent for BLR.)

const executiveText: IdentityText = {
  glyph: "CK",
  serif: "mono",
  registry: "Byelorussian SSR · Council of Ministers",
  title: "Supreme Soviet",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of Law · Byelorussian SSR",
  title: "National Policy",
};

/** The executive seal. */
const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Emblem_of_the_Byelorussian_Soviet_Socialist_Republic.svg/330px-Emblem_of_the_Byelorussian_Soviet_Socialist_Republic.svg.png",
  alt: "Emblem of the Byelorussian SSR",
};

const executiveSurface: ExecutiveSurfaceConfig = {
  clock: {
    kind: "plenum",
    label: "Plenum Clock",
    countdownNoun: "next Soviet session",
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
  heroImage: "/api/images/hero/belarus",
  heroAlt: "Supreme Soviet, Minsk",
};

/**
 * No parliamentary executive surface. `SURFACES` has no BLR entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for BLR.)

/**
 * No census label set. `REGION_CENSUS_LABELS` has no BLR entry and consumers
 * fall back to the generic labels -- the same text every unlisted country gets,
 * not BLR data behind a BLR-specific branch. Authoring one here would turn a
 * default into an authored value.
 */
// (regionCensusLabels is deliberately absent for BLR.)

/*
 * ⚠️ NO `stateDisplayNames` HERE, AND THAT IS THE POINT. This country's
 * display names are DERIVED at runtime in `commodityRegionMappings.ts` from
 * `blrRegions`, under a comment that says "no hand-maintained copies to
 * drift". Snapshotting that derivation into the folder created exactly such
 * a copy: a frozen literal that would not follow a renamed or added region.
 * The rosters are the single source; the folder must not restate them.
 */

/**
 * No historical NPC bank names.
 */
// (historicalNames is deliberately absent for BLR.)

/**
 * No modern NPC bank names.
 */
// (modernNames is deliberately absent for BLR.)

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "BY",
  command: "GENERAL STAFF",
  strip: "◆ СЕКРЕТНО",
  acc: "#f0a0a0",
};

export const BLR_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "Belarus",
  national,
  treasuryText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
};
