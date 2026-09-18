import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";

import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * Poland's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/pl.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts PL "Poland" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

/**
 * No CABINET_IDENTITY row. getCabinetIdentity falls back to its documented shell.
 */
// (cabinet is deliberately absent for PL.)

const national: NationalIdentity = {
  glyph: "PL",
  serif: "mono",
  motif: "gearStar",
  name: "Polish State Holdings",
  native: "Polskie Przedsiębiorstwo Państwowe",
  registry: "Polish People's Republic · State Asset Registry",
  ministry: "STATE PLANNING COMMISSION",
  publicSeal: "PUBLIC REGISTER",
  hqCity: "Warsaw",
  palette: ["#3a0d0d", "#2a0a0a", "#150606"],
  accent: "#cdb15a",
  accentSoft: "#e2cd8c",
  accentName: "Polish red & gold",
};

/**
 * No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;
 * authoring that default here would make the fallback look chosen.
 */
// (stats is deliberately absent for PL.)

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "PL",
  serif: "mono",
  budgetTitle: "State Plan Budget",
  ministry: "MINISTRY OF FINANCE",
  publicSeal: "PUBLIC RECORD",
  registry: "Polish People's Republic · Ministry of Finance",
  native: "Polska Rzeczpospolita Ludowa · Ministerstwo Finansów",
};

/**
 * No ECONOMY_TEXT row. The reader falls back to DEFAULT_ECONOMY_TEXT.
 */
// (economyText is deliberately absent for PL.)

const executiveText: IdentityText = {
  glyph: "RM",
  serif: "mono",
  registry: "Polish People's Republic · Council of Ministers",
  title: "Sejm",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of Law · Polish People's Republic",
  title: "National Policy",
};

/** The executive seal. */
const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Coat_of_arms_of_the_People's_Republic_of_Poland.svg/330px-Coat_of_arms_of_the_People's_Republic_of_Poland.svg.png",
  alt: "Coat of arms of the Polish People's Republic",
};

const executiveSurface: ExecutiveSurfaceConfig = {
  clock: {
    kind: "plenum",
    label: "Plenum Clock",
    countdownNoun: "next Sejm session",
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
  heroImage: "/api/images/hero/poland",
  heroAlt: "Sejm, Warsaw",
};

/**
 * No parliamentary executive surface. `SURFACES` has no PL entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for PL.)

/**
 * No census label set. `REGION_CENSUS_LABELS` has no PL entry and consumers
 * fall back to the generic labels -- the same text every unlisted country gets,
 * not PL data behind a PL-specific branch. Authoring one here would turn a
 * default into an authored value.
 */
// (regionCensusLabels is deliberately absent for PL.)

/*
 * ⚠️ NO `stateDisplayNames` HERE, AND THAT IS THE POINT. This country's
 * display names are DERIVED at runtime in `commodityRegionMappings.ts` from
 * `plRegions`, under a comment that says "no hand-maintained copies to
 * drift". Snapshotting that derivation into the folder created exactly such
 * a copy: a frozen literal that would not follow a renamed or added region.
 * The rosters are the single source; the folder must not restate them.
 */

/**
 * No historical NPC bank names.
 */
// (historicalNames is deliberately absent for PL.)

/**
 * No modern NPC bank names.
 */
// (modernNames is deliberately absent for PL.)

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "PL",
  command: "SZTAB GENERALNY",
  strip: "◆ TAJNE",
  acc: "#f0a0a0",
};

export const PL_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "Poland",
  national,
  treasuryText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
};
