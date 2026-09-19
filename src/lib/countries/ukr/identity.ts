import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";

import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * Ukraine's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/ukr.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts UKR "Ukraine" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

/**
 * No CABINET_IDENTITY row. getCabinetIdentity falls back to its documented shell.
 */
// (cabinet is deliberately absent for UKR.)

const national: NationalIdentity = {
  glyph: "UKR",
  serif: "mono",
  motif: "gearStar",
  name: "Ukrainian State Enterprise",
  native: "Державне Підприємство",
  registry: "Ukrainian SSR · State Asset Registry",
  ministry: "GOSPLAN URSR",
  publicSeal: "PUBLIC REGISTER",
  hqCity: "Kyiv",
  palette: ["#3a0d0d", "#2a0a0a", "#150606"],
  accent: "#cdb15a",
  accentSoft: "#e2cd8c",
  accentName: "Soviet red & gold",
};

/**
 * No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;
 * authoring that default here would make the fallback look chosen.
 */
// (stats is deliberately absent for UKR.)

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "UKR",
  serif: "mono",
  budgetTitle: "State Plan Budget",
  ministry: "MINISTRY OF FINANCE",
  publicSeal: "PUBLIC RECORD",
  registry: "Ukrainian SSR · Ministry of Finance",
  native: "Українська РСР · Міністерство фінансів",
};

/**
 * No ECONOMY_TEXT row. The reader falls back to DEFAULT_ECONOMY_TEXT.
 */
// (economyText is deliberately absent for UKR.)

const executiveText: IdentityText = {
  glyph: "YK",
  serif: "mono",
  registry: "Ukrainian SSR · Council of Ministers",
  title: "Supreme Soviet",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of Law · Ukrainian SSR",
  title: "National Policy",
};

/** The executive seal. */
const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Emblem_of_the_Ukrainian_SSR.svg/330px-Emblem_of_the_Ukrainian_SSR.svg.png",
  alt: "Emblem of the Ukrainian SSR",
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
  heroImage: "/api/images/hero/ukraine",
  heroAlt: "Supreme Soviet, Kyiv",
};

/**
 * No parliamentary executive surface. `SURFACES` has no UKR entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for UKR.)

/**
 * No census label set. `REGION_CENSUS_LABELS` has no UKR entry and consumers
 * fall back to the generic labels -- the same text every unlisted country gets,
 * not UKR data behind a UKR-specific branch. Authoring one here would turn a
 * default into an authored value.
 */
// (regionCensusLabels is deliberately absent for UKR.)

/**
 * No region display names. `STATE_DISPLAY_NAMES` has no UKR entry; the map
 * falls back to `compactRegionCode(countryId, stateId)`, which derives from the
 * state id rather than naming anything. There is no value here to move.
 */
// (stateDisplayNames is deliberately absent for UKR.)

/**
 * No historical NPC bank names.
 */
// (historicalNames is deliberately absent for UKR.)

/**
 * No modern NPC bank names.
 */
// (modernNames is deliberately absent for UKR.)

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "UA",
  command: "KYIV MILITARY DISTRICT",
  strip: "◆ СЕКРЕТНО",
  acc: "#f0a0a0",
};

export const UKR_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "Ukraine",
  national,
  treasuryText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
};
