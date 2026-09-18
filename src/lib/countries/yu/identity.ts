import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";

import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * Yugoslavia's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/yu.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts YU "Yugoslavia" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

/**
 * No CABINET_IDENTITY row. getCabinetIdentity falls back to its documented shell.
 */
// (cabinet is deliberately absent for YU.)

const national: NationalIdentity = {
  glyph: "YU",
  serif: "mono",
  motif: "gearStar",
  name: "Yugoslav Social Enterprise",
  native: "Društveno Preduzeće",
  registry: "SFR Yugoslavia · Self-Management Registry",
  ministry: "FEDERAL PLANNING INSTITUTE",
  publicSeal: "PUBLIC REGISTER",
  hqCity: "Belgrade",
  palette: ["#1a2a3a", "#121f2a", "#0a1015"],
  accent: "#9aa7c5",
  accentSoft: "#c2cbe0",
  accentName: "Yugoslav blue",
};

/**
 * No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;
 * authoring that default here would make the fallback look chosen.
 */
// (stats is deliberately absent for YU.)

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "YU",
  serif: "mono",
  budgetTitle: "Federal Budget",
  ministry: "FEDERAL SECRETARIAT FOR FINANCE",
  publicSeal: "PUBLIC RECORD",
  registry: "SFR Yugoslavia · Federal Secretariat for Finance",
  native: "SFR Jugoslavija · Savezni sekretarijat za finansije",
};

/**
 * No ECONOMY_TEXT row. The reader falls back to DEFAULT_ECONOMY_TEXT.
 */
// (economyText is deliberately absent for YU.)

const executiveText: IdentityText = {
  glyph: "SK",
  serif: "mono",
  registry: "SFR Yugoslavia · Federal Executive Council",
  title: "Federal Assembly",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of Law · SFR Yugoslavia",
  title: "National Policy",
};

/** The executive seal. */
const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Emblem_of_SFR_Yugoslavia.svg/330px-Emblem_of_SFR_Yugoslavia.svg.png",
  alt: "Emblem of SFR Yugoslavia",
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
  rosterTitle: "Federal Executive Council",
  heroImage: "/api/images/hero/yugoslavia",
  heroAlt: "Federal Assembly, Belgrade",
};

/**
 * No parliamentary executive surface. `SURFACES` has no YU entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for YU.)

/**
 * No census label set. `REGION_CENSUS_LABELS` has no YU entry and consumers
 * fall back to the generic labels -- the same text every unlisted country gets,
 * not YU data behind a YU-specific branch. Authoring one here would turn a
 * default into an authored value.
 */
// (regionCensusLabels is deliberately absent for YU.)

/*
 * ⚠️ NO `stateDisplayNames` HERE, AND THAT IS THE POINT. This country's
 * display names are DERIVED at runtime in `commodityRegionMappings.ts` from
 * `yuRegions`, under a comment that says "no hand-maintained copies to
 * drift". Snapshotting that derivation into the folder created exactly such
 * a copy: a frozen literal that would not follow a renamed or added region.
 * The rosters are the single source; the folder must not restate them.
 */

/**
 * No historical NPC bank names.
 */
// (historicalNames is deliberately absent for YU.)

/**
 * No modern NPC bank names.
 */
// (modernNames is deliberately absent for YU.)

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "YU",
  command: "GENERALŠTAB",
  strip: "◆ DRŽAVNA TAJNA",
  acc: "#86d978",
};

export const YU_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "Yugoslavia",
  national,
  treasuryText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
};
