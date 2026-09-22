import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { CabinetIdentity } from "@/lib/constants/cabinetIdentity";

import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";

import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { CountryIdentity } from "../contract";

/**
 * Russia's names, labels and surface text.
 *
 * ⚠ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Every value below was
 * read out of `__snapshots__/ru.pre-move.json`, emitted from the live
 * registries before anything moved. Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-identity.ts RU "Russia" --force
 *
 * ⚠ TREASURY_IDENTITY IS NOT HERE, DELIBERATELY. It is computed from
 * TREASURY_TEXT plus the national palette (`treasuryIdentity.ts`), so it
 * recomposes itself once the text moves. Forwarding the derived one would create
 * a second source of the same values.
 */

const cabinet: CabinetIdentity = {
  glyph: "СМ",
  serif: "mono",
  gov: "#d9a93e",
  govSoft: "#eccb7d",
  g0: "#4d0f0f",
  g1: "#320b0b",
  g2: "#1a0707",
};

const national: NationalIdentity = {
  glyph: "СССР",
  serif: "mono",
  motif: "gearStar",
  name: "All-Union State Enterprise",
  native: "Государственное Предприятие СССР",
  registry: "Union of Soviet Socialist Republics · State Asset Registry",
  ministry: "GOSPLAN",
  publicSeal: "PUBLIC REGISTER",
  hqCity: "Moscow",
  palette: ["#3a0d0d", "#2a0a0a", "#150606"],
  accent: "#cdb15a",
  accentSoft: "#e2cd8c",
  accentName: "Soviet red & gold",
};

/**
 * No NATIONAL_STATS_IDENTITY row. The reader falls back to DEFAULT_STATS_IDENTITY;
 * authoring that default here would make the fallback look chosen.
 */
// (stats is deliberately absent for RU.)

/** The authored text only. The palette is pulled from `national` downstream. */
const treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft"> = {
  glyph: "СССР",
  serif: "mono",
  budgetTitle: "State Plan Budget",
  ministry: "MINISTRY OF FINANCE",
  publicSeal: "PUBLIC RECORD",
  registry: "Union of Soviet Socialist Republics · Ministry of Finance",
  native: "СССР · Министерство финансов",
};

/**
 * No ECONOMY_TEXT row. The reader falls back to DEFAULT_ECONOMY_TEXT.
 */
// (economyText is deliberately absent for RU.)

const executiveText: IdentityText = {
  glyph: "CCCP",
  serif: "mono",
  registry: "Union of Soviet Socialist Republics · Council of Ministers",
  title: "The Kremlin",
};

const policyText: IdentityText = {
  glyph: "§",
  serif: "mono",
  registry: "Code of Law · Union of Soviet Socialist Republics",
  title: "National Policy",
};

const executiveSeal: ExecutiveSeal = {
  src: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/State_Emblem_of_the_Soviet_Union.svg/330px-State_Emblem_of_the_Soviet_Union.svg.png",
  alt: "State Emblem of the Soviet Union",
};

const executiveSurface: ExecutiveSurfaceConfig = {
  clock: {
    kind: "plenum",
    label: "Plenum Clock",
    countdownNoun: "next Supreme Soviet session",
  },
  actLabels: {
    signed: "ENACTED",
    vetoed: "REJECTED",
    onDesk: "AWAITING",
    order: "DECREE",
    confirmed: "APPOINTED",
    nominated: "NOMINATED",
    acting: "ACTING",
  },
  deskKind: "orders",
  deskLabel: "Decrees",
  rosterTitle: "Council of Ministers",
  heroImage: "/api/images/hero/kremlin",
  heroAlt: "The Kremlin, Moscow",
};

/**
 * No parliamentary executive surface. `SURFACES` has no RU entry, and for a
 * presidential country that is correct rather than missing: there is no
 * parliamentary executive for a surface to describe. `contract.test.ts` requires
 * this field of parliamentary countries only.
 */
// (parliamentarySurface is deliberately absent for RU.)

/**
 * No census label set. `REGION_CENSUS_LABELS` has no RU entry and consumers
 * fall back to the generic labels -- the same text every unlisted country gets,
 * not RU data behind a RU-specific branch. Authoring one here would turn a
 * default into an authored value.
 */
// (regionCensusLabels is deliberately absent for RU.)

/**
 * No region display names. `STATE_DISPLAY_NAMES` has no RU entry; the map
 * falls back to `compactRegionCode(countryId, stateId)`, which derives from the
 * state id rather than naming anything. There is no value here to move.
 */
// (stateDisplayNames is deliberately absent for RU.)

/**
 * No historical NPC bank names.
 */
// (historicalNames is deliberately absent for RU.)

/**
 * No modern NPC bank names.
 */
// (modernNames is deliberately absent for RU.)

/** Situation-board dressing: high-command name, classification strip, accent. */
const commandFlavor: CountryCommandFlavor = {
  glyph: "RU",
  command: "GENERAL STAFF",
  strip: "◆ СЕКРЕТНО · ACTIVE THEATERS",
  acc: "#f0a0a0",
};

export const RU_IDENTITY: CountryIdentity = {
  commandFlavor,
  displayName: "Russia",
  cabinet,
  national,
  treasuryText,
  executiveText,
  policyText,
  executiveSeal,
  executiveSurface,
};
