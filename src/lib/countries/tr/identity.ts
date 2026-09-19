import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";

import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * Turkey's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/tr.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts TR "Turkey" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

/**
 * No CABINET_IDENTITY row. getCabinetIdentity falls back to its documented shell.
 */
// (cabinet is deliberately absent for TR.)

const national: NationalIdentity = {
  glyph: "TC",
  serif: "mono",
  motif: "gear",
  name: "Turkish State Enterprise",
  native: "Kamu İktisadi Teşekkülü (KİT)",
  registry: "Republic of Turkey · State Holdings Registry",
  ministry: "MINISTRY OF FINANCE",
  publicSeal: "PUBLIC REGISTER",
  hqCity: "Ankara",
  palette: ["#3a0d0d", "#2a0a0a", "#150606"],
  accent: "#e02a2a",
  accentSoft: "#f08a8a",
  accentName: "Turkish red & white",
};

/**
 * No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;
 * authoring that default here would make the fallback look chosen.
 */
// (stats is deliberately absent for TR.)

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "TC",
  serif: "mono",
  budgetTitle: "State Budget",
  ministry: "MINISTRY OF FINANCE",
  publicSeal: "PUBLIC RECORD",
  registry: "Republic of Turkey · Ministry of Finance",
  native: "Türkiye Cumhuriyeti · Maliye Bakanlığı",
};

/**
 * No ECONOMY_TEXT row. The reader falls back to DEFAULT_ECONOMY_TEXT.
 */
// (economyText is deliberately absent for TR.)

const executiveText: IdentityText = {
  glyph: "TC",
  serif: "mono",
  registry: "Republic of Turkey · Prime Ministry",
  title: "Çankaya",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of Law · Republic of Turkey",
  title: "National Policy",
};

/** The executive seal. */
const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Emblem_of_Turkey.svg/330px-Emblem_of_Turkey.svg.png",
  alt: "Emblem of Turkey",
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
  rosterTitle: "Council of Ministers",
  heroImage: "/api/images/hero/cankaya",
  heroAlt: "Çankaya Mansion, Ankara",
};

/**
 * No parliamentary executive surface. `SURFACES` has no TR entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for TR.)

/**
 * No census label set. `REGION_CENSUS_LABELS` has no TR entry and consumers
 * fall back to the generic labels -- the same text every unlisted country gets,
 * not TR data behind a TR-specific branch. Authoring one here would turn a
 * default into an authored value.
 */
// (regionCensusLabels is deliberately absent for TR.)

/*
 * ⚠️ NO `stateDisplayNames` HERE, AND THAT IS THE POINT. This country's
 * display names are DERIVED at runtime in `commodityRegionMappings.ts` from
 * `trRegions`, under a comment that says "no hand-maintained copies to
 * drift". Snapshotting that derivation into the folder created exactly such
 * a copy: a frozen literal that would not follow a renamed or added region.
 * The rosters are the single source; the folder must not restate them.
 */

/** NPC bank names, pre-modernisation. */
const historicalNames: readonly string[] = ["Anatolian Commerce Bank", "Bosphorus Trading Bank"];

/** NPC bank names, post-modernisation. */
const modernNames: readonly string[] = ["Anatolian Commerce Group", "Bosphorus Financial"];

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "TR",
  command: "GENELKURMAY",
  strip: "◆ ÇOK GİZLİ",
  acc: "#9cc0f5",
};

export const TR_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "Turkey",
  national,
  treasuryText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
  historicalNames,
  modernNames,
};
