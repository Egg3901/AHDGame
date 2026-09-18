import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";

import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * Romania's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/ro.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts RO "Romania" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

/**
 * No CABINET_IDENTITY row. getCabinetIdentity falls back to its documented shell.
 */
// (cabinet is deliberately absent for RO.)

const national: NationalIdentity = {
  glyph: "RO",
  serif: "mono",
  motif: "gearStar",
  name: "Romanian State Holdings",
  native: "Întreprindere de Stat",
  registry: "Socialist Republic of Romania · State Asset Registry",
  ministry: "STATE PLANNING COMMITTEE",
  publicSeal: "PUBLIC REGISTER",
  hqCity: "Bucharest",
  palette: ["#0d2a3a", "#0a1f2a", "#061015"],
  accent: "#cdb15a",
  accentSoft: "#e2cd8c",
  accentName: "Romanian blue & gold",
};

/**
 * No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;
 * authoring that default here would make the fallback look chosen.
 */
// (stats is deliberately absent for RO.)

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "RO",
  serif: "mono",
  budgetTitle: "State Plan Budget",
  ministry: "MINISTRY OF FINANCE",
  publicSeal: "PUBLIC RECORD",
  registry: "Socialist Republic of Romania · Ministry of Finance",
  native: "Republica Socialistă România · Ministerul Finanțelor",
};

/**
 * No ECONOMY_TEXT row. The reader falls back to DEFAULT_ECONOMY_TEXT.
 */
// (economyText is deliberately absent for RO.)

const executiveText: IdentityText = {
  glyph: "CM",
  serif: "mono",
  registry: "Socialist Republic of Romania · Council of Ministers",
  title: "Grand National Assembly",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of Law · Socialist Republic of Romania",
  title: "National Policy",
};

/** The executive seal. */
const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fe/Coat_of_arms_of_the_Socialist_Republic_of_Romania.svg/330px-Coat_of_arms_of_the_Socialist_Republic_of_Romania.svg.png",
  alt: "Coat of arms of the Socialist Republic of Romania",
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
  heroImage: "/api/images/hero/romania",
  heroAlt: "Grand National Assembly, Bucharest",
};

/**
 * No parliamentary executive surface. `SURFACES` has no RO entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for RO.)

/**
 * No census label set. `REGION_CENSUS_LABELS` has no RO entry and consumers
 * fall back to the generic labels -- the same text every unlisted country gets,
 * not RO data behind a RO-specific branch. Authoring one here would turn a
 * default into an authored value.
 */
// (regionCensusLabels is deliberately absent for RO.)

/** Region display names (STATE_DISPLAY_NAMES), used by the commodity map. */
const stateDisplayNames: Record<string, string> = {
  RO_BUC: "Bucharest",
  RO_MUN: "Muntenia",
  RO_OLT: "Oltenia",
  RO_TRA: "Transylvania",
  RO_VST: "Banat & Crișana",
  RO_MOL: "Moldavia",
  RO_DOB: "Dobruja",
};

/**
 * No historical NPC bank names.
 */
// (historicalNames is deliberately absent for RO.)

/**
 * No modern NPC bank names.
 */
// (modernNames is deliberately absent for RO.)

export const RO_IDENTITY: CountryIdentity = {
  displayName: "Romania",
  national,
  treasuryText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
  stateDisplayNames,
};
