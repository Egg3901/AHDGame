import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";

import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * Italy's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/it.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts IT "Italy" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

/**
 * No CABINET_IDENTITY row. getCabinetIdentity falls back to its documented shell.
 */
// (cabinet is deliberately absent for IT.)

const national: NationalIdentity = {
  glyph: "RI",
  serif: "mono",
  motif: "gear",
  name: "Italian State Holdings",
  native: "Ente Pubblico (IRI/ENI)",
  registry: "Italian Republic · State Holdings Registry",
  ministry: "MINISTRY OF THE TREASURY",
  publicSeal: "PUBLIC REGISTER",
  hqCity: "Rome",
  palette: ["#0d3320", "#0a2618", "#06150d"],
  accent: "#cdb15a",
  accentSoft: "#e2cd8c",
  accentName: "Italian green & gold",
};

/**
 * No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;
 * authoring that default here would make the fallback look chosen.
 */
// (stats is deliberately absent for IT.)

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "RI",
  serif: "mono",
  budgetTitle: "State Budget",
  ministry: "MINISTRY OF THE TREASURY",
  publicSeal: "PUBLIC RECORD",
  registry: "Italian Republic · Ministry of the Treasury",
  native: "Repubblica Italiana · Ministero del Tesoro",
};

/**
 * No ECONOMY_TEXT row. The reader falls back to DEFAULT_ECONOMY_TEXT.
 */
// (economyText is deliberately absent for IT.)

const executiveText: IdentityText = {
  glyph: "RI",
  serif: "mono",
  registry: "Italian Republic · Presidency of the Council",
  title: "Palazzo Chigi",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of Law · Italian Republic",
  title: "National Policy",
};

/** The executive seal. */
const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/Emblem_of_Italy.svg/330px-Emblem_of_Italy.svg.png",
  alt: "Emblem of Italy",
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
  heroImage: "/api/images/hero/palazzo-chigi",
  heroAlt: "Palazzo Chigi, Rome",
};

/**
 * No parliamentary executive surface. `SURFACES` has no IT entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for IT.)

/**
 * No census label set. `REGION_CENSUS_LABELS` has no IT entry and consumers
 * fall back to the generic labels -- the same text every unlisted country gets,
 * not IT data behind a IT-specific branch. Authoring one here would turn a
 * default into an authored value.
 */
// (regionCensusLabels is deliberately absent for IT.)

/*
 * ⚠️ NO `stateDisplayNames` HERE, AND THAT IS THE POINT. This country's
 * display names are DERIVED at runtime in `commodityRegionMappings.ts` from
 * `itRegions`, under a comment that says "no hand-maintained copies to
 * drift". Snapshotting that derivation into the folder created exactly such
 * a copy: a frozen literal that would not follow a renamed or added region.
 * The rosters are the single source; the folder must not restate them.
 */

/** NPC bank names, pre-modernisation. */
const historicalNames: readonly string[] = ["Banca Adriatica", "Credito Tirreno"];

/** NPC bank names, post-modernisation. */
const modernNames: readonly string[] = ["Banca Adriatica Group", "Credito Tirreno"];

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "IT",
  command: "STATO MAGGIORE DIFESA",
  strip: "◆ SEGRETO",
  acc: "#9cc0f5",
};

export const IT_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "Italy",
  national,
  treasuryText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
  historicalNames,
  modernNames,
};
