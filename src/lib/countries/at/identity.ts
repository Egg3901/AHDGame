import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";

import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * Austria's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/at.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts AT "Austria" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

/**
 * No CABINET_IDENTITY row. getCabinetIdentity falls back to its documented shell.
 */
// (cabinet is deliberately absent for AT.)

const national: NationalIdentity = {
  glyph: "ÖS",
  serif: "mono",
  motif: "laurel",
  name: "Austrian State Industries",
  native: "Österreichische Industrieholding",
  registry: "Republic of Austria · State Holdings Registry",
  ministry: "MINISTRY OF FINANCE",
  publicSeal: "PUBLIC REGISTER",
  hqCity: "Vienna",
  palette: ["#3a0d14", "#2a0a10", "#150608"],
  accent: "#d64545",
  accentSoft: "#eb9a9a",
  accentName: "Austrian red & white",
};

/**
 * No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;
 * authoring that default here would make the fallback look chosen.
 */
// (stats is deliberately absent for AT.)

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "BM",
  serif: "mono",
  budgetTitle: "Federal Budget",
  ministry: "MINISTRY OF FINANCE",
  publicSeal: "PUBLIC RECORD",
  registry: "Republic of Austria · Federal Ministry of Finance",
  native: "Republik Österreich · Bundesministerium für Finanzen",
};

/**
 * No ECONOMY_TEXT row. The reader falls back to DEFAULT_ECONOMY_TEXT.
 */
// (economyText is deliberately absent for AT.)

const executiveText: IdentityText = {
  glyph: "BK",
  serif: "mono",
  registry: "Republic of Austria · Federal Government",
  title: "Ballhausplatz",
  titleEn: "Federal Chancellery",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of Law · Republic of Austria",
  title: "National Policy",
};

/** The executive seal. */
const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Coat_of_arms_of_Austria.svg/330px-Coat_of_arms_of_Austria.svg.png",
  alt: "Coat of arms of Austria (Bundesadler)",
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
  rosterTitle: "Council of Ministers",
  heroImage: "/api/images/hero/ballhausplatz",
  heroAlt: "Federal Chancellery at Ballhausplatz, Vienna",
};

/**
 * No parliamentary executive surface. `SURFACES` has no AT entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for AT.)

/**
 * No census label set. `REGION_CENSUS_LABELS` has no AT entry and consumers
 * fall back to the generic labels -- the same text every unlisted country gets,
 * not AT data behind a AT-specific branch. Authoring one here would turn a
 * default into an authored value.
 */
// (regionCensusLabels is deliberately absent for AT.)

/*
 * ⚠️ NO `stateDisplayNames` HERE, AND THAT IS THE POINT. This country's
 * display names are DERIVED at runtime in `commodityRegionMappings.ts` from
 * `atRegions`, under a comment that says "no hand-maintained copies to
 * drift". Snapshotting that derivation into the folder created exactly such
 * a copy: a frozen literal that would not follow a renamed or added region.
 * The rosters are the single source; the folder must not restate them.
 */

/** NPC bank names, pre-modernisation. */
const historicalNames: readonly string[] = ["Alpine Credit Bank", "Danube Commercial Bank"];

/** NPC bank names, post-modernisation. */
const modernNames: readonly string[] = ["Alpine Credit Group", "Danube Banking Group"];

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "AT",
  command: "BUNDESHEER",
  strip: "◆ VERSCHLUSSSACHE",
  acc: "#86d978",
};

export const AT_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "Austria",
  national,
  treasuryText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
  historicalNames,
  modernNames,
};
