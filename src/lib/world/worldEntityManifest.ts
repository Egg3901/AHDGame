import {
  COUNTRY_CONFIGS,
  COUNTRY_ORDER,
  getCountryDisplayName,
  type CountryId,
  type CountryStatus,
} from "@/lib/constants/countries";
import {
  formatCapabilityBlocker,
  TIER1_1953_AUTONOMOUS_RECLASSIFICATIONS,
  TIER1_1953_UNCONFIGURED_PROPOSED,
  tier1FollowUpIssue,
  UNCONFIGURED_BLOCKER_CAPABILITIES,
  type TierReclassificationRecord,
} from "@/lib/world/tier1Readiness1953Data";
import { build1953Tier3Registry } from "./registry/assemble";

export type WorldEntityId = string;
export type WorldEntityStatus = "sovereign" | "dependent" | "emergent" | "dissolved";
export type WorldSimulationTier = "full-autonomous" | "sphere-macro" | "historical-presence";
export type WorldEconomicArchetype = "market" | "planned" | "mixed" | "macro" | "none";
export type ReadinessResult = "ready" | "blocked";
export type LegacyCountryAccess = "player" | "economy-preview" | "hidden" | "config-fallback";
/** Treaty posture for a sphere relationship (see src/lib/world/spheres/). */
export type WorldEntityTreatyState = "none" | "proposed" | "active" | "suspended";
/**
 * Geographic coverage bucket for the #3728 Tier-3 registry gate.
 * Middle East polities are filed under `asia` (Asia / Pacific roster in the epic).
 * Egypt is filed under `africa` to match the registry checklist.
 */
export type WorldEntityRegion = "europe" | "americas" | "africa" | "asia" | "pacific";
/** Diplomatic recognition posture for map / UN / transition read models. */
export type WorldRecognitionStatus =
  "widely-recognized" | "partial" | "contested" | "unrecognized" | "dependent";
/** UN membership lifecycle — same vocabulary as historical transitions. */
export type WorldUnLifecycleState = "ineligible" | "eligible" | "applied" | "admitted" | "rejected";
/**
 * Explicit exceptional statuses for entities that are not ordinary
 * metropolitan dependencies (mandates, condominiums, disputed claimants).
 */
export type WorldExceptionalStatus =
  | "disputed-sovereignty"
  | "international-mandate"
  | "un-trust-territory"
  | "condominium"
  | "international-zone"
  | "integral-overseas";

export interface WorldEntityRelationship {
  sponsorId: WorldEntityId;
  alignment: number;
  integration: number;
  treatyIds: string[];
  /** Whether treaty obligations are live for sphere flows. Defaults to none. */
  treatyState?: WorldEntityTreatyState;
}

export interface WorldEntityLifecycle {
  earliestYear?: number;
  expectedYear?: number;
  latestYear?: number;
  transitionRuleIds: string[];
}

export interface WorldEntityRecognition {
  status: WorldRecognitionStatus;
  notes?: string;
}

export interface WorldEntityUnRecord {
  state: WorldUnLifecycleState;
  /** Year of UN admission on the historical default path, when admitted. */
  memberSinceYear?: number;
  /** Expected admission year for eligible / emergent polities. */
  expectedAdmissionYear?: number;
}

export interface WorldEntityReadiness {
  autonomous: ReadinessResult;
  player: ReadinessResult;
  hardBlockers: string[];
  flavorGaps: string[];
}

/**
 * Preset-scoped source record for a historical political entity.
 *
 * `countryId` is present only when the entity is already backed by the deep
 * CountryConfig domain. Tier-2 and Tier-3 entities can exist in the world
 * manifest before they are promoted into that much narrower type.
 */
export interface WorldEntityManifestEntry {
  entityId: WorldEntityId;
  countryId?: CountryId;
  presetId: string;
  displayName: string;
  status: WorldEntityStatus;
  parentEntityId?: WorldEntityId;
  /**
   * Additional administering powers for dual trusteeships / condominiums
   * (e.g. Somalia Trust Territories under Italy + UK in 1953).
   */
  coParentEntityIds?: readonly WorldEntityId[];
  /** Non-ordinary dependency / disputed-claimant posture (#3728). */
  exceptionalStatus?: WorldExceptionalStatus;
  /** Coverage region for the Tier-3 registry gate. Optional on legacy rows. */
  region?: WorldEntityRegion;
  simulationTier: WorldSimulationTier;
  economicArchetype: WorldEconomicArchetype;
  sphere: {
    canSponsor: boolean;
    primarySphereId?: string;
    relationships: WorldEntityRelationship[];
  };
  lifecycle: WorldEntityLifecycle;
  /** Diplomatic recognition — required for Tier-3; filled for CountryConfig rows too. */
  recognition?: WorldEntityRecognition;
  /** UN lifecycle defaults (strong priors, not rails). */
  un?: WorldEntityUnRecord;
  /**
   * Natural Earth ISO 3166-1 numeric feature IDs used as modern geometry proxies.
   * Historical entities without a clean proxy stay in `unmappedEntityIds`.
   */
  mapFeatureIds?: string[];
  readiness: WorldEntityReadiness;
  /**
   * Compatibility seam for the existing countryGameStates access model.
   * #3714 consumes this field; #3713 deliberately leaves runtime behavior
   * unchanged.
   */
  legacyAccess: LegacyCountryAccess;
  legacyStatus?: CountryStatus;
  /**
   * Visible record when a proposed Tier-1 candidate was demoted after the
   * readiness matrix (#3723). Absent when the entity was never proposed as
   * Tier 1 or remained full-autonomous.
   */
  tierReclassification?: TierReclassificationRecord;
}

export interface WorldEntityPresetManifest {
  presetId: string;
  entries: readonly WorldEntityManifestEntry[];
}

const PLANNED_ECONOMIES = new Set<CountryId>([
  "RU",
  "CN",
  "DD",
  "PL",
  "RO",
  "YU",
  "HU",
  "CS",
  "BG",
  // Union republics: the most completely planned economies in the set - there
  // was no private plot and no second economy of the Polish or Yugoslav kind.
  "UKR",
  "BLR",
  "BAL",
]);

const PLAYER_BLOCKER = "Player access is not enabled for this entity in the active preset.";
const AUTONOMY_BLOCKER =
  "The entity is not wired for a full autonomous country simulation in this preset.";

function readinessForAccess(access: LegacyCountryAccess): WorldEntityReadiness {
  if (access === "player") {
    return { autonomous: "ready", player: "ready", hardBlockers: [], flavorGaps: [] };
  }
  if (access === "economy-preview") {
    return {
      autonomous: "ready",
      player: "blocked",
      hardBlockers: [PLAYER_BLOCKER],
      flavorGaps: [],
    };
  }
  return {
    autonomous: "blocked",
    player: "blocked",
    hardBlockers: [AUTONOMY_BLOCKER, PLAYER_BLOCKER],
    flavorGaps: [],
  };
}

function tierForAccess(access: LegacyCountryAccess): WorldSimulationTier {
  return access === "player" || access === "economy-preview"
    ? "full-autonomous"
    : "historical-presence";
}

function accessFromConfig(countryId: CountryId): LegacyCountryAccess {
  const status = COUNTRY_CONFIGS[countryId].status;
  if (status === "active") return "player";
  if (status === "beta") return "economy-preview";
  return "hidden";
}

/** Coverage region for CountryConfig-backed entities (1953 gate + diagnostics). */
const COUNTRY_REGIONS: Record<CountryId, WorldEntityRegion> = {
  US: "americas",
  BR: "americas",
  UK: "europe",
  FR: "europe",
  DE: "europe",
  DD: "europe",
  IT: "europe",
  ES: "europe",
  SE: "europe",
  IE: "europe",
  HU: "europe",
  PL: "europe",
  RO: "europe",
  YU: "europe",
  BG: "europe",
  CS: "europe",
  UKR: "europe",
  RU: "europe",
  TR: "europe",
  JP: "asia",
  CN: "asia",
  NG: "africa",
  AT: "europe",
  GR: "europe",
  FI: "europe",
  BLR: "europe",
  BAL: "europe",
  SCO: "europe",
  WAL: "europe",
};

/** UN admission year priors for CountryConfig sovereigns (strong defaults). */
const COUNTRY_UN_MEMBER_SINCE: Partial<Record<CountryId, number>> = {
  US: 1945,
  UK: 1945,
  FR: 1945,
  RU: 1945,
  CN: 1945,
  BR: 1945,
  DE: undefined, // FRG admitted 1973
  DD: undefined, // GDR admitted 1973
  IT: 1955,
  ES: 1955,
  SE: 1946,
  TR: 1945,
  JP: 1956,
  IE: 1955,
  NG: 1960,
  PL: 1945,
  HU: 1955,
  RO: 1955,
  BG: 1955,
  // The Ukrainian and Byelorussian SSRs were UN founding members in their own
  // right - Stalin's price for the Yalta voting arrangement. This is real, not a
  // modelling convenience, and it is the single largest thing that separates
  // them from the Baltic republics, whose annexation the UN never recognised and
  // which therefore have no admission year at all.
  UKR: 1945,
  BLR: 1945,
  YU: 1945,
  CS: 1945,
  GR: 1945,
  AT: 1955,
  FI: 1955,
};

/**
 * Preset-specific sphere-sponsor eligibility (#3718).
 * Independent of human control — DDR (`DD`) is intentionally absent (non-sponsoring).
 */
const SPHERE_SPONSOR_ELIGIBILITY: Readonly<Partial<Record<string, ReadonlySet<CountryId>>>> =
  Object.freeze({
    "1953-default": Object.freeze(new Set<CountryId>(["US", "UK", "RU", "FR", "CN"])),
    "1979-default": Object.freeze(new Set<CountryId>(["US", "UK", "RU", "FR", "CN"])),
    "1991-default": Object.freeze(new Set<CountryId>(["US", "UK", "RU", "FR", "CN"])),
    "1999-default": Object.freeze(new Set<CountryId>(["US", "UK", "RU", "FR", "CN"])),
    "2007-default": Object.freeze(new Set<CountryId>(["US", "UK", "RU", "FR", "CN"])),
    "2019-default": Object.freeze(new Set<CountryId>(["US", "UK", "RU", "FR", "CN", "DE", "JP"])),
  });

/** True when the preset matrix lists this entity as a sphere sponsor. */
export function isManifestSphereSponsor(presetId: string, entityId: WorldEntityId): boolean {
  const eligible = SPHERE_SPONSOR_ELIGIBILITY[presetId];
  if (!eligible) return false;
  return eligible.has(entityId as CountryId);
}

function buildCountryEntry(
  presetId: string,
  countryId: CountryId,
  legacyAccess: LegacyCountryAccess
): WorldEntityManifestEntry {
  const resolvedAccess =
    legacyAccess === "config-fallback" ? accessFromConfig(countryId) : legacyAccess;
  const unMemberSince = COUNTRY_UN_MEMBER_SINCE[countryId];
  // Product decision 2026-07-25: Nigeria is a Tier-1 full country in 1953
  // (self-governing under the Macpherson/Lyttleton trajectory). Keep UN fields
  // era-honest — Nigeria was not a UN member until 1960.
  const nigeria1953 = presetId === "1953-default" && countryId === "NG";

  return {
    entityId: countryId,
    countryId,
    presetId,
    displayName: getCountryDisplayName(countryId, presetId),
    status: "sovereign",
    region: COUNTRY_REGIONS[countryId],
    simulationTier: tierForAccess(resolvedAccess),
    economicArchetype: PLANNED_ECONOMIES.has(countryId) ? "planned" : "market",
    sphere: {
      canSponsor: isManifestSphereSponsor(presetId, countryId),
      relationships: [],
    },
    lifecycle: {
      transitionRuleIds: [],
    },
    recognition: nigeria1953
      ? {
          status: "widely-recognized",
          notes:
            "Self-governing Federation of Nigeria under the Macpherson Constitution (1951) with Lyttleton reforms underway; independence window opens 1960.",
        }
      : { status: "widely-recognized" },
    un: nigeria1953
      ? { state: "eligible", expectedAdmissionYear: 1960 }
      : unMemberSince != null
        ? { state: "admitted", memberSinceYear: unMemberSince }
        : { state: "eligible", expectedAdmissionYear: 1955 },
    readiness: readinessForAccess(resolvedAccess),
    legacyAccess,
    legacyStatus:
      legacyAccess === "player"
        ? "active"
        : legacyAccess === "economy-preview"
          ? "beta"
          : legacyAccess === "hidden"
            ? "coming-soon"
            : undefined,
  };
}

function entriesFromAccess(
  presetId: string,
  access: Partial<Record<CountryId, LegacyCountryAccess>>
): WorldEntityManifestEntry[] {
  return Object.entries(access).map(([countryId, legacyAccess]) =>
    buildCountryEntry(presetId, countryId as CountryId, legacyAccess)
  );
}

function configFallbackEntries(presetId: string): WorldEntityManifestEntry[] {
  return COUNTRY_ORDER.map((countryId) =>
    buildCountryEntry(presetId, countryId, "config-fallback")
  );
}

const SPHERE_MACRO_BLOCKERS = [
  AUTONOMY_BLOCKER,
  PLAYER_BLOCKER,
  "Sphere-macro countries have no domestic player offices or firm simulation.",
] as const;

function sphereMacroEntry(args: {
  entityId: WorldEntityId;
  presetId: string;
  displayName: string;
  economicArchetype: WorldEconomicArchetype;
  region: WorldEntityRegion;
  countryId?: CountryId;
  primarySphereId?: string;
  relationships?: WorldEntityRelationship[];
  recognition?: WorldEntityRecognition;
  un?: WorldEntityUnRecord;
  mapFeatureIds?: string[];
}): WorldEntityManifestEntry {
  return {
    entityId: args.entityId,
    countryId: args.countryId,
    presetId: args.presetId,
    displayName: args.displayName,
    status: "sovereign",
    region: args.region,
    simulationTier: "sphere-macro",
    economicArchetype: args.economicArchetype,
    sphere: {
      canSponsor: false,
      primarySphereId: args.primarySphereId,
      relationships: args.relationships ?? [],
    },
    lifecycle: { transitionRuleIds: [] },
    recognition: args.recognition ?? { status: "widely-recognized" },
    un: args.un ?? { state: "eligible", expectedAdmissionYear: 1955 },
    mapFeatureIds: args.mapFeatureIds,
    readiness: {
      autonomous: "blocked",
      player: "blocked",
      hardBlockers: [...SPHERE_MACRO_BLOCKERS],
      flavorGaps: [],
    },
    legacyAccess: "hidden",
    legacyStatus: "coming-soon",
  };
}

function emergentSphereMacro(
  presetId: string,
  opts: {
    entityId: WorldEntityId;
    displayName: string;
    region: WorldEntityRegion;
    earliestYear: number;
    expectedYear: number;
    latestYear: number;
    transitionRuleId: string;
    primarySphereId: string;
    relationships: WorldEntityRelationship[];
    mapFeatureIds?: string[];
  }
): WorldEntityManifestEntry {
  return {
    entityId: opts.entityId,
    presetId,
    displayName: opts.displayName,
    status: "emergent",
    region: opts.region,
    simulationTier: "sphere-macro",
    economicArchetype: "macro",
    sphere: {
      canSponsor: false,
      primarySphereId: opts.primarySphereId,
      relationships: opts.relationships,
    },
    lifecycle: {
      earliestYear: opts.earliestYear,
      expectedYear: opts.expectedYear,
      latestYear: opts.latestYear,
      transitionRuleIds: [opts.transitionRuleId],
    },
    recognition: {
      status: "unrecognized",
      notes: `Emergent until ${opts.displayName} sovereignty succeeds.`,
    },
    un: { state: "ineligible", expectedAdmissionYear: opts.expectedYear },
    mapFeatureIds: opts.mapFeatureIds,
    readiness: {
      autonomous: "blocked",
      player: "blocked",
      hardBlockers: [
        AUTONOMY_BLOCKER,
        PLAYER_BLOCKER,
        `${opts.displayName} is emergent until its sovereignty transition succeeds.`,
        "Sphere-macro countries have no domestic player offices or firm simulation.",
      ],
      flavorGaps: [],
    },
    legacyAccess: "hidden",
    legacyStatus: "coming-soon",
  };
}

function colonialDependency(
  presetId: string,
  opts: {
    entityId: WorldEntityId;
    displayName: string;
    region: WorldEntityRegion;
    parentEntityId: WorldEntityId;
    coParentEntityIds?: readonly WorldEntityId[];
    exceptionalStatus?: WorldExceptionalStatus;
    earliestYear: number;
    expectedYear: number;
    latestYear: number;
    transitionRuleId: string;
    flavorGaps?: string[];
    mapFeatureIds?: string[];
    recognitionNotes?: string;
  }
): WorldEntityManifestEntry {
  return {
    entityId: opts.entityId,
    presetId,
    displayName: opts.displayName,
    status: "dependent",
    parentEntityId: opts.parentEntityId,
    coParentEntityIds: opts.coParentEntityIds,
    exceptionalStatus: opts.exceptionalStatus,
    region: opts.region,
    simulationTier: "historical-presence",
    economicArchetype: "none",
    sphere: {
      canSponsor: false,
      relationships: [],
    },
    lifecycle: {
      earliestYear: opts.earliestYear,
      expectedYear: opts.expectedYear,
      latestYear: opts.latestYear,
      transitionRuleIds: [opts.transitionRuleId],
    },
    recognition: {
      status: "dependent",
      notes: opts.recognitionNotes,
    },
    un: { state: "ineligible", expectedAdmissionYear: opts.expectedYear },
    mapFeatureIds: opts.mapFeatureIds,
    readiness: {
      autonomous: "blocked",
      player: "blocked",
      hardBlockers: [
        AUTONOMY_BLOCKER,
        PLAYER_BLOCKER,
        "Dependencies have no independent sphere or domestic player simulation.",
      ],
      flavorGaps: opts.flavorGaps ?? [],
    },
    legacyAccess: "hidden",
    legacyStatus: "coming-soon",
  };
}

/**
 * Emergent sphere-macro targets for decolonization transitions (#3726 / #3727).
 * Not seeded until sovereignty; authored Tier-2 rosters remain separate.
 */
function emergentDecolonizationEntries(presetId: string): WorldEntityManifestEntry[] {
  if (presetId !== "1953-default") return [];
  return [
    emergentSphereMacro(presetId, {
      entityId: "GH",
      displayName: "Ghana",
      region: "africa",
      mapFeatureIds: ["288"],
      earliestYear: 1954,
      expectedYear: 1957,
      latestYear: 1962,
      transitionRuleId: "gold-coast-to-ghana",
      primarySphereId: "UK",
      relationships: [
        {
          sponsorId: "UK",
          alignment: 0.55,
          integration: 0.35,
          treatyIds: ["commonwealth-membership"],
          treatyState: "proposed",
        },
        {
          sponsorId: "US",
          alignment: 0.35,
          integration: 0.15,
          treatyIds: [],
          treatyState: "none",
        },
      ],
    }),
    emergentSphereMacro(presetId, {
      entityId: "SO",
      displayName: "Somalia",
      region: "africa",
      earliestYear: 1958,
      expectedYear: 1960,
      latestYear: 1965,
      transitionRuleId: "somalia-trust-to-somalia",
      primarySphereId: "US",
      relationships: [
        {
          sponsorId: "US",
          alignment: 0.4,
          integration: 0.2,
          treatyIds: [],
          treatyState: "none",
        },
        {
          sponsorId: "UK",
          alignment: 0.35,
          integration: 0.2,
          treatyIds: ["commonwealth-membership"],
          treatyState: "proposed",
        },
        {
          sponsorId: "IT",
          alignment: 0.3,
          integration: 0.15,
          treatyIds: [],
          treatyState: "none",
        },
      ],
    }),
    emergentSphereMacro(presetId, {
      entityId: "CD",
      displayName: "Congo",
      region: "africa",
      earliestYear: 1958,
      expectedYear: 1960,
      latestYear: 1965,
      transitionRuleId: "belgian-congo-to-congo",
      primarySphereId: "US",
      relationships: [
        {
          sponsorId: "US",
          alignment: 0.45,
          integration: 0.2,
          treatyIds: [],
          treatyState: "none",
        },
        {
          sponsorId: "BE",
          alignment: 0.35,
          integration: 0.25,
          treatyIds: [],
          treatyState: "none",
        },
      ],
    }),
    emergentSphereMacro(presetId, {
      entityId: "DZ",
      displayName: "Algeria",
      region: "africa",
      mapFeatureIds: ["012"],
      earliestYear: 1959,
      expectedYear: 1962,
      latestYear: 1967,
      transitionRuleId: "french-algeria-to-algeria",
      primarySphereId: "FR",
      relationships: [
        {
          sponsorId: "FR",
          alignment: 0.45,
          integration: 0.3,
          treatyIds: ["evian-accords"],
          treatyState: "proposed",
        },
        {
          sponsorId: "RU",
          alignment: 0.3,
          integration: 0.1,
          treatyIds: [],
          treatyState: "none",
        },
      ],
    }),
    emergentSphereMacro(presetId, {
      entityId: "GY",
      displayName: "Guyana",
      region: "americas",
      mapFeatureIds: ["328"],
      earliestYear: 1961,
      expectedYear: 1966,
      latestYear: 1971,
      transitionRuleId: "british-guiana-to-guyana",
      primarySphereId: "UK",
      relationships: [
        {
          sponsorId: "UK",
          alignment: 0.55,
          integration: 0.35,
          treatyIds: ["commonwealth-membership"],
          treatyState: "proposed",
        },
        {
          sponsorId: "US",
          alignment: 0.4,
          integration: 0.2,
          treatyIds: [],
          treatyState: "none",
        },
      ],
    }),
    emergentSphereMacro(presetId, {
      entityId: "YD",
      displayName: "South Yemen",
      region: "asia",
      earliestYear: 1963,
      expectedYear: 1967,
      latestYear: 1972,
      transitionRuleId: "aden-to-south-yemen",
      primarySphereId: "RU",
      relationships: [
        {
          sponsorId: "RU",
          alignment: 0.55,
          integration: 0.3,
          treatyIds: ["soviet-friendship"],
          treatyState: "proposed",
        },
        {
          sponsorId: "UK",
          alignment: 0.2,
          integration: 0.1,
          treatyIds: [],
          treatyState: "none",
        },
      ],
    }),
    emergentSphereMacro(presetId, {
      entityId: "AO",
      displayName: "Angola",
      region: "africa",
      mapFeatureIds: ["024"],
      earliestYear: 1970,
      expectedYear: 1975,
      latestYear: 1980,
      transitionRuleId: "portuguese-angola-to-angola",
      primarySphereId: "RU",
      relationships: [
        {
          sponsorId: "RU",
          alignment: 0.55,
          integration: 0.3,
          treatyIds: ["soviet-friendship"],
          treatyState: "proposed",
        },
        {
          sponsorId: "US",
          alignment: 0.2,
          integration: 0.1,
          treatyIds: [],
          treatyState: "none",
        },
      ],
    }),
    emergentSphereMacro(presetId, {
      entityId: "MZ",
      displayName: "Mozambique",
      region: "africa",
      mapFeatureIds: ["508"],
      earliestYear: 1970,
      expectedYear: 1975,
      latestYear: 1980,
      transitionRuleId: "portuguese-mozambique-to-mozambique",
      primarySphereId: "RU",
      relationships: [
        {
          sponsorId: "RU",
          alignment: 0.5,
          integration: 0.28,
          treatyIds: ["soviet-friendship"],
          treatyState: "proposed",
        },
        {
          sponsorId: "US",
          alignment: 0.2,
          integration: 0.1,
          treatyIds: [],
          treatyState: "none",
        },
      ],
    }),
  ];
}

/**
 * Entity IDs already classified by Tier-1/2 / decolonization on this branch.
 * Registry historical-presence rows for these IDs are dropped (HEAD tier wins).
 * Also drops ITS/BSL — HEAD models them as the combined ST Somalia Trust tracer.
 * Also drops BCO/BGY/BU — HEAD uses BC/BRG/MM instead.
 */
const HEAD_CLAIMED_1953_ENTITY_IDS: ReadonlySet<string> = new Set([
  "US",
  "UK",
  "RU",
  "DD",
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "DE",
  "JP",
  "CN",
  "BR",
  "NG",
  "AT",
  "FI",
  "GR",
  "IE",
  "PL",
  "CS",
  "HU",
  "RO",
  "BG",
  "YU",
  "JO",
  "AF",
  "YE",
  "MM",
  "LA",
  "KH",
  "TH",
  "IN",
  "PK",
  "IR",
  "IQ",
  "EG",
  "SA",
  "SY",
  "ID",
  "KP",
  "KR",
  "NVN",
  "SVN",
  "ET",
  "ZA",
  "CU",
  "GT",
  "PA",
  "NI",
  "CL",
  "AR",
  "MX",
  "VE",
  "GH",
  "SO",
  "CD",
  "DZ",
  "GY",
  "YD",
  "AO",
  "MZ",
  "GC",
  "ST",
  "BC",
  "FA",
  "BRG",
  "ADN",
  "POA",
  "PM",
  "ITS",
  "BSL",
  "BCO",
  "BGY",
  "BU",
]);

/** Decolonization dependency tracers (#3726 / #3727). */
function decolonizationDependencyEntries(presetId: string): WorldEntityManifestEntry[] {
  if (presetId !== "1953-default") return [];
  return [
    colonialDependency(presetId, {
      entityId: "GC",
      displayName: "Gold Coast",
      region: "africa",
      mapFeatureIds: ["288"],
      parentEntityId: "UK",
      earliestYear: 1954,
      expectedYear: 1957,
      latestYear: 1962,
      transitionRuleId: "gold-coast-to-ghana",
    }),
    colonialDependency(presetId, {
      entityId: "ST",
      displayName: "Somalia Trust Territories",
      region: "africa",
      exceptionalStatus: "un-trust-territory",
      recognitionNotes:
        "Italian UN Trust Territory of Somaliland plus British Somaliland as one dependency record.",
      parentEntityId: "IT",
      coParentEntityIds: ["UK"],
      earliestYear: 1958,
      expectedYear: 1960,
      latestYear: 1965,
      transitionRuleId: "somalia-trust-to-somalia",
      flavorGaps: [
        "Models the Italian UN Trust Territory of Somaliland plus British Somaliland as one dependency record.",
      ],
    }),
    colonialDependency(presetId, {
      entityId: "BC",
      displayName: "Belgian Congo",
      region: "africa",
      mapFeatureIds: ["180"],
      parentEntityId: "BE",
      earliestYear: 1958,
      expectedYear: 1960,
      latestYear: 1965,
      transitionRuleId: "belgian-congo-to-congo",
    }),
    colonialDependency(presetId, {
      entityId: "FA",
      displayName: "French Algeria",
      region: "africa",
      exceptionalStatus: "integral-overseas",
      mapFeatureIds: ["012"],
      recognitionNotes: "French départements d'Algérie.",
      parentEntityId: "FR",
      earliestYear: 1959,
      expectedYear: 1962,
      latestYear: 1967,
      transitionRuleId: "french-algeria-to-algeria",
    }),
    colonialDependency(presetId, {
      entityId: "BRG",
      displayName: "British Guiana",
      region: "americas",
      mapFeatureIds: ["328"],
      parentEntityId: "UK",
      earliestYear: 1961,
      expectedYear: 1966,
      latestYear: 1971,
      transitionRuleId: "british-guiana-to-guyana",
    }),
    colonialDependency(presetId, {
      entityId: "ADN",
      displayName: "Aden Protectorate",
      region: "asia",
      parentEntityId: "UK",
      earliestYear: 1963,
      expectedYear: 1967,
      latestYear: 1972,
      transitionRuleId: "aden-to-south-yemen",
    }),
    colonialDependency(presetId, {
      entityId: "POA",
      displayName: "Portuguese Angola",
      region: "africa",
      mapFeatureIds: ["024"],
      parentEntityId: "PT",
      earliestYear: 1970,
      expectedYear: 1975,
      latestYear: 1980,
      transitionRuleId: "portuguese-angola-to-angola",
    }),
    colonialDependency(presetId, {
      entityId: "PM",
      displayName: "Portuguese Mozambique",
      region: "africa",
      mapFeatureIds: ["508"],
      parentEntityId: "PT",
      earliestYear: 1970,
      expectedYear: 1975,
      latestYear: 1980,
      transitionRuleId: "portuguese-mozambique-to-mozambique",
    }),
  ];
}

/**
 * Tier-3 historical-presence entities that are not already Tier-1/2 on this branch.
 * Gold Coast / decolonization tracers stay authored above; the global 1953 registry
 * (#3728) fills the remainder under src/lib/world/registry/.
 */
function historicalPresenceEntries(presetId: string): WorldEntityManifestEntry[] {
  if (presetId !== "1953-default") return [];
  const registry = build1953Tier3Registry(presetId).filter(
    (entry) => !HEAD_CLAIMED_1953_ENTITY_IDS.has(entry.entityId)
  );
  return [...decolonizationDependencyEntries(presetId), ...registry];
}

/**
 * Full-autonomous readiness override for AT/FI/GR/IE, applied on top of the base
 * `sphereMacroEntry(...)` result below (#3791). These countries were originally
 * authored as Tier-2 sphere-macro NPC entries (`legacyAccess: "hidden"`) but
 * `bootstrapGameWorld.ts` (`seedATRegions`/`seedATParties`/…,
 * mirroring `seedFRRegions`/`seedFRParties`/…) and `ECON_TIER_ROSTER_COUNTRIES`
 * in `seedEconTierRosters.ts` build them out with real states, parties, and
 * NPP incumbents — identically to FR/IT/ES/SE/TR — and `COUNTRY_ORDER`'s own
 * doc comment lists GR/AT/FI as "registered: real configs + seed data, gated
 * per-preset by countryGameStates" alongside FR/IT/ES/SE/TR.
 *
 * The sphere-macro classification never caught up: `explicitCountryEntries`
 * (seedCountryGameStates.ts) requires a country-backed economy-preview entry.
 * AT/FI/GR lacked a `countryId`, while IE remained hidden despite its investable
 * sector seed. This override brings their access tier in line with what is
 * actually seeded without touching their sphere, recognition, or UN flavor data.
 */
function promoteEuropeanSphereMacroToFullAutonomous(
  entry: WorldEntityManifestEntry,
  countryId: CountryId
): WorldEntityManifestEntry {
  return {
    ...entry,
    countryId,
    simulationTier: "full-autonomous",
    legacyAccess: "economy-preview",
    legacyStatus: "beta",
    readiness: {
      autonomous: "ready",
      player: "blocked",
      hardBlockers: [
        formatCapabilityBlocker(
          "adminDiagnostics",
          "No COUNTRY_READINESS_EXPECTATIONS entry.",
          tier1FollowUpIssue(countryId, "adminDiagnostics")
        ),
      ],
      flavorGaps: ["bespokeEvents", "artAssets", "wikiMaterial"],
    },
  };
}

/**
 * European 1953 sphere-macro roster (#3719). AT/FI/GR/IE are promoted to
 * full-autonomous economy-preview entries (see
 * `promoteEuropeanSphereMacroToFullAutonomous` above). Their sphere
 * relationships/recognition/UN posture below are unchanged occupation-era
 * flavor data is not affected by the promotion. CS/YU/DD stay unmapped.
 * Warsaw Pact / Yugoslavia reuse existing CountryIds with hidden legacy access.
 * ES is the inverse: demoted from full-autonomous to sphere-macro for
 * 1953-default ONLY (owner decision, 2026-07-28) — Franco's Spain never holds
 * a legislative election in this preset, so it stays an abstract Tier-2
 * economy here while remaining full-autonomous in every later preset.
 */
function europeanSphereMacroEntries(presetId: string): WorldEntityManifestEntry[] {
  if (presetId !== "1953-default") return [];
  return [
    promoteEuropeanSphereMacroToFullAutonomous(
      sphereMacroEntry({
        entityId: "AT",
        presetId,
        displayName: "Austria",
        region: "europe",
        recognition: {
          status: "widely-recognized",
          notes: "Occupied sovereign; State Treaty expected 1955.",
        },
        un: { state: "eligible", expectedAdmissionYear: 1955 },
        mapFeatureIds: ["040"],
        economicArchetype: "market",
        // Occupation-era soft Western lean; US is the sole primary (#3717).
        // Neutrality settles after the 1955 State Treaty.
        primarySphereId: "US",
        relationships: [
          {
            sponsorId: "US",
            alignment: 0.45,
            integration: 0.2,
            treatyIds: ["occupation-western-1953", "marshall-plan-erp"],
            treatyState: "active",
          },
          {
            sponsorId: "UK",
            alignment: 0.4,
            integration: 0.15,
            treatyIds: ["occupation-western-1953"],
            treatyState: "active",
          },
          {
            sponsorId: "RU",
            alignment: 0.25,
            integration: 0.15,
            treatyIds: ["occupation-soviet-zone-1953"],
            treatyState: "active",
          },
        ],
      }),
      "AT"
    ),
    promoteEuropeanSphereMacroToFullAutonomous(
      sphereMacroEntry({
        entityId: "FI",
        presetId,
        displayName: "Finland",
        region: "europe",
        un: { state: "eligible", expectedAdmissionYear: 1955 },
        mapFeatureIds: ["246"],
        economicArchetype: "market",
        primarySphereId: "RU",
        relationships: [
          { sponsorId: "RU", alignment: 0.55, integration: 0.35, treatyIds: [] }, // FCMA
          { sponsorId: "SE", alignment: 0.4, integration: 0.2, treatyIds: [] },
        ],
      }),
      "FI"
    ),
    promoteEuropeanSphereMacroToFullAutonomous(
      sphereMacroEntry({
        entityId: "GR",
        presetId,
        displayName: "Greece",
        region: "europe",
        un: { state: "admitted", memberSinceYear: 1945 },
        mapFeatureIds: ["300"],
        economicArchetype: "market",
        primarySphereId: "US",
        relationships: [
          { sponsorId: "US", alignment: 0.65, integration: 0.4, treatyIds: [] }, // NATO 1952
          { sponsorId: "UK", alignment: 0.45, integration: 0.25, treatyIds: [] },
        ],
      }),
      "GR"
    ),
    promoteEuropeanSphereMacroToFullAutonomous(
      sphereMacroEntry({
        entityId: "IE",
        countryId: "IE",
        presetId,
        displayName: "Ireland",
        region: "europe",
        un: { state: "eligible", expectedAdmissionYear: 1955 },
        economicArchetype: "market",
        primarySphereId: "UK",
        relationships: [
          { sponsorId: "UK", alignment: 0.55, integration: 0.45, treatyIds: [] }, // sterling area
          { sponsorId: "US", alignment: 0.35, integration: 0.15, treatyIds: [] },
        ],
      }),
      "IE"
    ),
    // Spain: demoted to sphere-macro for 1953 ONLY (owner decision, 2026-07-28
    // coverage audit). 1953 Spain is Franco's dictatorship — congresoDiputados
    // and the Senado are both era-gated off via a shared null anchor, so a
    // "full-autonomous, economy-preview" Spain never holds an election for the
    // life of a 1953-default world; it was an economy-only power wearing a
    // Tier-1 label. Kept as a countryId-backed sphere-macro entry rather than
    // an abstract NPC; its regions/parties/budget seed
    // data still resolves, it simply is not routed through the Tier-1
    // election/player machinery. Spain stays full-autonomous economy-preview
    // in 1979/1991/1999/2007-default (Franco died 1975; 1977 was Spain's first
    // democratic election) and historical-presence in 2019-default — this
    // preset guard only ever returns entries for "1953-default", so those
    // presets are untouched. See COLD_WAR_ECONOMY / POST_COLD_WAR_ECONOMY
    // below, which still carry "ES" for 1979+; the sphere-macro entry built
    // here wins the 1953 manifest slot via last-write-wins entityId dedup in
    // apply1953Tier1MatrixAdjustments (ES is intentionally removed from that
    // function's FR/IT/SE/TR full-autonomous re-affirmation loop below).
    sphereMacroEntry({
      entityId: "ES",
      countryId: "ES",
      presetId,
      displayName: "Spain",
      region: "europe",
      un: { state: "eligible", expectedAdmissionYear: 1955 },
      economicArchetype: "market",
      primarySphereId: "US",
      relationships: [
        // Pact of Madrid, 26 Sep 1953 — US bases-for-aid agreement; Spain
        // stays outside NATO and the UN admits it only in 1955.
        { sponsorId: "US", alignment: 0.35, integration: 0.15, treatyIds: ["pact-of-madrid-1953"] },
      ],
    }),
    // PL/CS/HU/RO/BG/YU + UKR/BLR/BAL promoted to full-autonomous Tier-1
    // (product decision 2026-07-25). Sphere relationship data is re-applied on their full-country
    // entries in apply1953Tier1MatrixAdjustments — not seeded as sphere-macro.
  ];
}

/**
 * Asian / Middle Eastern 1953 sphere-macro roster (#3720).
 * No CountryIds yet — map geometry unmapped; entityIds are ISO-like codes.
 * North Yemen (YE) is the Mutawakkilite Kingdom; Burma uses MM (ISO) with era name.
 */
function asianMiddleEastSphereMacroEntries(presetId: string): WorldEntityManifestEntry[] {
  if (presetId !== "1953-default") return [];
  return [
    sphereMacroEntry({
      entityId: "JO",
      presetId,
      mapFeatureIds: ["400"],
      displayName: "Jordan",
      region: "asia",
      un: { state: "admitted", memberSinceYear: 1955 },
      economicArchetype: "market",
      primarySphereId: "UK",
      relationships: [
        { sponsorId: "UK", alignment: 0.7, integration: 0.55, treatyIds: [] }, // Arab Legion / subsidy
        { sponsorId: "US", alignment: 0.45, integration: 0.25, treatyIds: [] },
      ],
    }),
    sphereMacroEntry({
      entityId: "AF",
      presetId,
      mapFeatureIds: ["004"],
      displayName: "Afghanistan",
      region: "asia",
      economicArchetype: "market",
      primarySphereId: "US",
      relationships: [
        // Non-aligned monarchy courted by both blocs (Helmand / military missions).
        { sponsorId: "US", alignment: 0.35, integration: 0.2, treatyIds: [] },
        { sponsorId: "RU", alignment: 0.3, integration: 0.15, treatyIds: [] },
        { sponsorId: "UK", alignment: 0.25, integration: 0.1, treatyIds: [] },
      ],
    }),
    sphereMacroEntry({
      entityId: "YE",
      presetId,
      mapFeatureIds: ["887"],
      displayName: "North Yemen",
      region: "asia",
      un: { state: "ineligible" },
      economicArchetype: "market",
      relationships: [
        // Isolated Imamate; weak ties vs Aden (UK) to the south.
        { sponsorId: "UK", alignment: 0.2, integration: 0.08, treatyIds: [] },
      ],
    }),
    sphereMacroEntry({
      entityId: "MM",
      presetId,
      mapFeatureIds: ["104"],
      displayName: "Burma",
      region: "asia",
      un: { state: "admitted", memberSinceYear: 1948 },
      economicArchetype: "market",
      primarySphereId: "UK",
      relationships: [
        // Non-aligned under U Nu; residual Commonwealth links before full exit path.
        { sponsorId: "UK", alignment: 0.35, integration: 0.2, treatyIds: [] },
        { sponsorId: "US", alignment: 0.25, integration: 0.1, treatyIds: [] },
        { sponsorId: "CN", alignment: 0.2, integration: 0.1, treatyIds: [] },
      ],
    }),
    sphereMacroEntry({
      entityId: "LA",
      presetId,
      mapFeatureIds: ["418"],
      displayName: "Laos",
      region: "asia",
      economicArchetype: "market",
      primarySphereId: "FR",
      relationships: [
        { sponsorId: "FR", alignment: 0.55, integration: 0.4, treatyIds: [] }, // Associated State residual
        { sponsorId: "US", alignment: 0.35, integration: 0.2, treatyIds: [] },
      ],
    }),
    sphereMacroEntry({
      entityId: "KH",
      presetId,
      mapFeatureIds: ["116"],
      displayName: "Cambodia",
      region: "asia",
      economicArchetype: "market",
      primarySphereId: "FR",
      relationships: [
        { sponsorId: "FR", alignment: 0.5, integration: 0.35, treatyIds: [] },
        { sponsorId: "US", alignment: 0.3, integration: 0.15, treatyIds: [] },
      ],
    }),
    sphereMacroEntry({
      entityId: "TH",
      presetId,
      mapFeatureIds: ["764"],
      displayName: "Thailand",
      region: "asia",
      economicArchetype: "market",
      primarySphereId: "US",
      relationships: [
        { sponsorId: "US", alignment: 0.65, integration: 0.45, treatyIds: [] }, // SEATO-bound trajectory
        { sponsorId: "UK", alignment: 0.4, integration: 0.2, treatyIds: [] },
      ],
    }),
  ];
}

/**
 * African and American 1953 sphere-macro roster (#3721).
 * No CountryIds yet — map geometry unmapped; entityIds are ISO-like codes.
 * Colonial dependencies (Gold Coast/Congo/Algeria/etc.) stay Tier 3; NG is Tier 1.
 */
function africaAmericasSphereMacroEntries(presetId: string): WorldEntityManifestEntry[] {
  if (presetId !== "1953-default") return [];
  return [
    sphereMacroEntry({
      entityId: "ET",
      presetId,
      mapFeatureIds: ["231"],
      displayName: "Ethiopia",
      region: "africa",
      un: { state: "admitted", memberSinceYear: 1945 },
      economicArchetype: "market",
      primarySphereId: "US",
      relationships: [
        { sponsorId: "US", alignment: 0.45, integration: 0.25, treatyIds: [] }, // Kagnew / military aid
        { sponsorId: "UK", alignment: 0.3, integration: 0.15, treatyIds: [] },
      ],
    }),
    sphereMacroEntry({
      entityId: "ZA",
      presetId,
      mapFeatureIds: ["710"],
      displayName: "South Africa",
      region: "africa",
      un: { state: "admitted", memberSinceYear: 1945 },
      economicArchetype: "market",
      primarySphereId: "UK",
      relationships: [
        { sponsorId: "UK", alignment: 0.65, integration: 0.5, treatyIds: [] }, // Commonwealth / sterling
        { sponsorId: "US", alignment: 0.4, integration: 0.25, treatyIds: [] },
      ],
    }),
    sphereMacroEntry({
      entityId: "CU",
      presetId,
      mapFeatureIds: ["192"],
      displayName: "Cuba",
      region: "americas",
      economicArchetype: "market",
      relationships: [
        { sponsorId: "US", alignment: 0.75, integration: 0.65, treatyIds: [] }, // pre-revolution sugar/capital
      ],
    }),
    sphereMacroEntry({
      entityId: "GT",
      presetId,
      mapFeatureIds: ["320"],
      displayName: "Guatemala",
      region: "americas",
      economicArchetype: "market",
      relationships: [
        { sponsorId: "US", alignment: 0.55, integration: 0.45, treatyIds: [] }, // UFCO / growing hostility under Arbenz
      ],
    }),
    sphereMacroEntry({
      entityId: "PA",
      presetId,
      mapFeatureIds: ["591"],
      displayName: "Panama",
      region: "americas",
      economicArchetype: "market",
      relationships: [
        { sponsorId: "US", alignment: 0.8, integration: 0.7, treatyIds: [] }, // Canal Zone
      ],
    }),
    sphereMacroEntry({
      entityId: "NI",
      presetId,
      mapFeatureIds: ["558"],
      displayName: "Nicaragua",
      region: "americas",
      economicArchetype: "market",
      relationships: [
        { sponsorId: "US", alignment: 0.7, integration: 0.55, treatyIds: [] }, // Somoza alignment
      ],
    }),
    sphereMacroEntry({
      entityId: "CL",
      presetId,
      mapFeatureIds: ["152"],
      displayName: "Chile",
      region: "americas",
      economicArchetype: "market",
      primarySphereId: "US",
      relationships: [
        { sponsorId: "US", alignment: 0.55, integration: 0.4, treatyIds: [] }, // copper capital
        { sponsorId: "UK", alignment: 0.3, integration: 0.15, treatyIds: [] },
      ],
    }),
    sphereMacroEntry({
      entityId: "AR",
      presetId,
      mapFeatureIds: ["032"],
      displayName: "Argentina",
      region: "americas",
      economicArchetype: "market",
      primarySphereId: "UK",
      relationships: [
        // Perón third-positionism: cooler toward US than neighbours.
        { sponsorId: "US", alignment: 0.35, integration: 0.2, treatyIds: [] },
        { sponsorId: "UK", alignment: 0.4, integration: 0.25, treatyIds: [] }, // meat/sterling trade
      ],
    }),
    sphereMacroEntry({
      entityId: "MX",
      presetId,
      mapFeatureIds: ["484"],
      displayName: "Mexico",
      region: "americas",
      economicArchetype: "market",
      relationships: [{ sponsorId: "US", alignment: 0.55, integration: 0.4, treatyIds: [] }],
    }),
    sphereMacroEntry({
      entityId: "VE",
      presetId,
      mapFeatureIds: ["862"],
      displayName: "Venezuela",
      region: "americas",
      economicArchetype: "market",
      relationships: [
        { sponsorId: "US", alignment: 0.7, integration: 0.55, treatyIds: [] }, // oil majors / Pérez Jiménez
      ],
    }),
  ];
}

export function defineWorldEntityPresetManifest(
  presetId: string,
  entries: readonly WorldEntityManifestEntry[]
): WorldEntityPresetManifest {
  if (!presetId.trim()) throw new Error("World entity manifest presetId is required.");

  const seen = new Set<string>();
  const byId = new Map<string, WorldEntityManifestEntry>();
  for (const entry of entries) {
    if (entry.presetId !== presetId) {
      throw new Error(
        `World entity ${entry.entityId} belongs to ${entry.presetId}, not ${presetId}.`
      );
    }
    if (!entry.entityId.trim() || !entry.displayName.trim()) {
      throw new Error(`World entity in ${presetId} is missing an ID or display name.`);
    }
    if (seen.has(entry.entityId)) {
      throw new Error(`Duplicate world entity ${entry.entityId} in ${presetId}.`);
    }
    seen.add(entry.entityId);
    byId.set(entry.entityId, entry);

    if (entry.status === "dependent" && !entry.parentEntityId && !entry.exceptionalStatus) {
      throw new Error(
        `Dependent entity ${entry.entityId} is missing a parent or exceptional status.`
      );
    }
    if (entry.parentEntityId === entry.entityId) {
      throw new Error(`World entity ${entry.entityId} cannot depend on itself.`);
    }
    if (entry.coParentEntityIds) {
      for (const coParent of entry.coParentEntityIds) {
        if (!coParent.trim()) {
          throw new Error(`World entity ${entry.entityId} has an empty co-parent id.`);
        }
        if (coParent === entry.entityId || coParent === entry.parentEntityId) {
          throw new Error(`World entity ${entry.entityId} has an invalid co-parent ${coParent}.`);
        }
      }
    }
    if (entry.simulationTier === "historical-presence") {
      if (!entry.region) {
        throw new Error(`Tier-3 entity ${entry.entityId} is missing a coverage region.`);
      }
      if (!entry.recognition) {
        throw new Error(`Tier-3 entity ${entry.entityId} is missing recognition status.`);
      }
      if (!entry.un) {
        throw new Error(`Tier-3 entity ${entry.entityId} is missing UN lifecycle status.`);
      }
    }
    if (entry.readiness.player === "ready") {
      if (entry.readiness.autonomous !== "ready" || entry.simulationTier !== "full-autonomous") {
        throw new Error(
          `Player-ready entity ${entry.entityId} must be autonomous-ready and full-autonomous.`
        );
      }
      if (entry.readiness.hardBlockers.length > 0) {
        throw new Error(`Player-ready entity ${entry.entityId} cannot have hard blockers.`);
      }
    }
    if (entry.readiness.player === "blocked" && entry.readiness.hardBlockers.length === 0) {
      throw new Error(`Player-blocked entity ${entry.entityId} must explain why.`);
    }
    const sponsorIds = new Set<string>();
    for (const relationship of entry.sphere.relationships) {
      if (sponsorIds.has(relationship.sponsorId)) {
        throw new Error(
          `World entity ${entry.entityId} has a duplicate sphere sponsor ${relationship.sponsorId}.`
        );
      }
      sponsorIds.add(relationship.sponsorId);
      if (
        !Number.isFinite(relationship.alignment) ||
        relationship.alignment < 0 ||
        relationship.alignment > 1 ||
        !Number.isFinite(relationship.integration) ||
        relationship.integration < 0 ||
        relationship.integration > 1
      ) {
        throw new Error(`World entity ${entry.entityId} has an invalid sphere relationship value.`);
      }
      if (
        relationship.treatyState != null &&
        relationship.treatyState !== "none" &&
        relationship.treatyState !== "proposed" &&
        relationship.treatyState !== "active" &&
        relationship.treatyState !== "suspended"
      ) {
        throw new Error(`World entity ${entry.entityId} has an invalid treaty state.`);
      }
    }
    if (
      entry.sphere.primarySphereId != null &&
      entry.sphere.relationships.length > 0 &&
      !sponsorIds.has(entry.sphere.primarySphereId)
    ) {
      throw new Error(
        `World entity ${entry.entityId} primary sphere is not among its relationships.`
      );
    }
    if (entry.sphere.relationships.length > 1 && entry.sphere.primarySphereId == null) {
      throw new Error(
        `World entity ${entry.entityId} has multiple sphere relationships but no primarySphereId.`
      );
    }
  }

  for (const entry of entries) {
    if (entry.parentEntityId && !byId.has(entry.parentEntityId)) {
      throw new Error(
        `World entity ${entry.entityId} parent ${entry.parentEntityId} is not in preset ${presetId}.`
      );
    }
  }

  return { presetId, entries: [...entries] };
}

const COLD_WAR_PLAYER: CountryId[] = ["US", "UK", "RU", "DD"];
/**
 * Economy-preview Tier-1 roster for Cold War presets.
 * Nigeria + Eastern bloc (PL/CS/HU/RO/BG/YU plus the union republics
 * UKR/BLR/BAL) join FR/IT/ES/SE/TR/… as
 * full-autonomous in 1953 (product decision 2026-07-25). Ireland is also
 * economy-preview so its Tier-1 sectors remain investable, while player access
 * stays blocked.
 */
const COLD_WAR_ECONOMY: CountryId[] = [
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "DE",
  "JP",
  "CN",
  "BR",
  "NG",
  "PL",
  "CS",
  "HU",
  "RO",
  "BG",
  "YU",
  "UKR",
  "BLR",
  "BAL",
];
const COLD_WAR_HIDDEN_1979: CountryId[] = ["PL", "RO", "YU", "HU", "CS", "BG", "UKR", "BLR", "BAL"];
const POST_COLD_WAR_PLAYER: CountryId[] = ["US", "UK"];
const POST_COLD_WAR_ECONOMY: CountryId[] = [
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "DE",
  "JP",
  "CN",
  "NG",
  "BR",
  "IE",
  // AT/FI/GR: same real-configs-and-seed-data status as their FR/IT/ES/SE/TR
  // siblings (#3791) — added here so 1991/1999/2007-default also seed them
  // `status: "beta"` instead of silently freezing on config's "coming-soon".
  "AT",
  "FI",
  "GR",
];

function accessMap(
  player: readonly CountryId[],
  economy: readonly CountryId[],
  hidden: readonly CountryId[] = []
): Partial<Record<CountryId, LegacyCountryAccess>> {
  return Object.fromEntries([
    ...player.map((countryId) => [countryId, "player"] as const),
    ...economy.map((countryId) => [countryId, "economy-preview"] as const),
    ...hidden.map((countryId) => [countryId, "hidden"] as const),
  ]);
}

/**
 * Apply the #3723 Tier-1 readiness matrix outcomes to the 1953 manifest:
 * reclassify autonomous-blocked proposed Tier-1 countries, patch readiness
 * for remaining Tier-1 candidates, and add unconfigured proposed entities.
 */
function apply1953Tier1MatrixAdjustments(
  entries: WorldEntityManifestEntry[]
): WorldEntityManifestEntry[] {
  const byId = new Map(entries.map((entry) => [entry.entityId, entry] as const));

  for (const plan of TIER1_1953_AUTONOMOUS_RECLASSIFICATIONS) {
    const existing = byId.get(plan.entityId);
    if (!existing) {
      throw new Error(`Cannot reclassify missing 1953 entity ${plan.entityId}.`);
    }
    const hardBlockers = plan.autonomousBlockerCapabilityIds.map((capabilityId) =>
      formatCapabilityBlocker(
        capabilityId,
        plan.reason,
        tier1FollowUpIssue(plan.entityId, capabilityId)
      )
    );
    byId.set(plan.entityId, {
      ...existing,
      simulationTier: plan.appliedTier,
      economicArchetype: plan.economicArchetype,
      legacyAccess: "hidden",
      legacyStatus: "coming-soon",
      readiness: {
        autonomous: "blocked",
        player: "blocked",
        hardBlockers,
        flavorGaps: existing.readiness.flavorGaps,
      },
      tierReclassification: {
        proposedTier: "full-autonomous",
        appliedTier: plan.appliedTier,
        reason: plan.reason,
        followUpIssues: plan.followUpIssues,
      },
    });
  }

  // Japan 1953: explicit autonomous-ready / player-blocked resolution (#3723).
  const japan = byId.get("JP");
  if (japan) {
    byId.set("JP", {
      ...japan,
      simulationTier: "full-autonomous",
      readiness: {
        autonomous: "ready",
        player: "blocked",
        hardBlockers: [
          formatCapabilityBlocker(
            "adminDiagnostics",
            "Japan 1953 lacks established-player-country parity validation for its Diet/cabinet surface.",
            tier1FollowUpIssue("JP", "adminDiagnostics")
          ),
        ],
        flavorGaps: ["bespokeEvents", "artAssets", "wikiMaterial"],
      },
      tierReclassification: undefined,
    });
  }

  // FR/IT/SE/TR: contract-proven autonomous-ready; player-blocked on
  // adminDiagnostics (no COUNTRY_READINESS_EXPECTATIONS entry yet). #3723
  // re-promotion — do not demote via hand-authored blocker lists.
  // ES is deliberately excluded (2026-07-28 owner decision, see the ES
  // sphereMacroEntry in europeanSphereMacroEntries above) — it is a policy
  // demotion, not a readiness gap, so it must not be re-affirmed full-autonomous
  // here even though its own contract probes still report autonomous-ready.
  for (const entityId of ["FR", "IT", "SE", "TR"] as const) {
    const entry = byId.get(entityId);
    if (!entry) continue;
    byId.set(entityId, {
      ...entry,
      simulationTier: "full-autonomous",
      readiness: {
        autonomous: "ready",
        player: "blocked",
        hardBlockers: [
          formatCapabilityBlocker(
            "adminDiagnostics",
            "No COUNTRY_READINESS_EXPECTATIONS entry.",
            tier1FollowUpIssue(entityId, "adminDiagnostics")
          ),
        ],
        flavorGaps: ["bespokeEvents", "artAssets", "wikiMaterial"],
      },
      tierReclassification: undefined,
    });
  }

  // Brazil: autonomous-ready, player-blocked on cabinet + bill lifecycle.
  const brazil = byId.get("BR");
  if (brazil) {
    byId.set("BR", {
      ...brazil,
      simulationTier: "full-autonomous",
      readiness: {
        autonomous: "ready",
        player: "blocked",
        hardBlockers: [
          formatCapabilityBlocker(
            "cabinet",
            "No cabinet positions in POSITIONS_BY_COUNTRY.",
            tier1FollowUpIssue("BR", "cabinet")
          ),
          formatCapabilityBlocker(
            "billLifecycle",
            "No COUNTRY_BILL_PHASES entry.",
            tier1FollowUpIssue("BR", "billLifecycle")
          ),
        ],
        flavorGaps: ["bespokeEvents", "artAssets", "wikiMaterial"],
      },
    });
  }

  // Nigeria 1953: contract-proven autonomous-ready; player-blocked on billLifecycle
  // (presidential archetype — billLifecycle is player-parity only). Product decision
  // 2026-07-25 promotes NG to the Tier-1 roster; readiness gaps are work items.
  const nigeria = byId.get("NG");
  if (nigeria) {
    byId.set("NG", {
      ...nigeria,
      simulationTier: "full-autonomous",
      readiness: {
        autonomous: "ready",
        player: "blocked",
        hardBlockers: [
          formatCapabilityBlocker(
            "billLifecycle",
            "No COUNTRY_BILL_PHASES entry.",
            tier1FollowUpIssue("NG", "billLifecycle")
          ),
        ],
        flavorGaps: ["bespokeEvents", "artAssets", "wikiMaterial"],
      },
      tierReclassification: undefined,
    });
  }

  // Eastern bloc 1953 (PL/CS/HU/RO/BG/YU + UKR/BLR/BAL): product decision
  // 2026-07-25 promotes
  // them to Tier-1 full-autonomous / economy-preview. Contract-proven
  // autonomous-ready and player-ready (one-party + planned-economy); keep
  // economy-preview access (not auto-open) like DE/CN. Flavor gaps remain work
  // items. Preserve #3717 sphere relationship data on the full-country entries
  // (buildCountryEntry starts with relationships: []).
  const easternBlocSphere: Record<
    string,
    {
      primarySphereId?: string;
      relationships: WorldEntityRelationship[];
    }
  > = {
    PL: {
      primarySphereId: "RU",
      relationships: [{ sponsorId: "RU", alignment: 0.85, integration: 0.75, treatyIds: [] }],
    },
    CS: {
      primarySphereId: "RU",
      relationships: [{ sponsorId: "RU", alignment: 0.88, integration: 0.8, treatyIds: [] }],
    },
    HU: {
      primarySphereId: "RU",
      relationships: [{ sponsorId: "RU", alignment: 0.9, integration: 0.82, treatyIds: [] }],
    },
    RO: {
      primarySphereId: "RU",
      relationships: [{ sponsorId: "RU", alignment: 0.85, integration: 0.7, treatyIds: [] }],
    },
    BG: {
      primarySphereId: "RU",
      relationships: [{ sponsorId: "RU", alignment: 0.92, integration: 0.85, treatyIds: [] }],
    },
    // Yugoslavia: post-1948 Tito–Stalin split — non-aligned. Keep US+RU as
    // reference relationships; US is the aid/diplomatic primary (not formal
    // sphere membership). Validation requires a primary when relationships > 1.
    YU: {
      primarySphereId: "US",
      relationships: [
        { sponsorId: "US", alignment: 0.4, integration: 0.25, treatyIds: [] },
        { sponsorId: "RU", alignment: 0.2, integration: 0.1, treatyIds: [] },
      ],
    },
    // Union republics. Alignment and integration sit ABOVE every satellite,
    // including Bulgaria, because these were not allied states with their own
    // foreign ministries and their own armies - they were inside the union, on
    // the union's currency, inside the union's plan. Nothing here should read as
    // a country that could defect the way Romania drifted or Yugoslavia did.
    UKR: {
      primarySphereId: "RU",
      relationships: [{ sponsorId: "RU", alignment: 0.95, integration: 0.96, treatyIds: [] }],
    },
    BLR: {
      primarySphereId: "RU",
      relationships: [{ sponsorId: "RU", alignment: 0.97, integration: 0.97, treatyIds: [] }],
    },
    // The Baltics are the one place where alignment and integration part
    // company: administratively they are as integrated as Byelorussia, but the
    // population's consent is the lowest in the bloc, and in 1953 there is still
    // an armed resistance. Alignment is the lower number for that reason.
    BAL: {
      primarySphereId: "RU",
      relationships: [{ sponsorId: "RU", alignment: 0.86, integration: 0.95, treatyIds: [] }],
    },
  };
  for (const entityId of ["PL", "CS", "HU", "RO", "BG", "YU", "UKR", "BLR", "BAL"] as const) {
    const entry = byId.get(entityId);
    if (!entry) continue;
    const sphere = easternBlocSphere[entityId];
    // Union republics are NOT sovereign in 1953. `buildCountryEntry` stamps
    // every CountryConfig-backed entity "sovereign", which is right for the six
    // satellites - they were allied states with their own foreign ministries -
    // and wrong for UKR/BLR/BAL, which were constituent republics of the USSR.
    // The tier says how much of the simulation an entity carries; `status` says
    // who it answers to, and for these three those are different answers.
    // alignmentRoster.test.ts asserts the roster and the manifest agree here.
    const unionRepublic = entityId === "UKR" || entityId === "BLR" || entityId === "BAL";
    byId.set(entityId, {
      ...entry,
      ...(unionRepublic ? ({ status: "dependent", parentEntityId: "RU" } as const) : ({} as const)),
      simulationTier: "full-autonomous",
      economicArchetype: "planned",
      sphere: {
        canSponsor: false,
        primarySphereId: sphere.primarySphereId,
        relationships: sphere.relationships,
      },
      readiness: {
        autonomous: "ready",
        player: "ready",
        hardBlockers: [],
        flavorGaps: ["bespokeEvents", "artAssets", "wikiMaterial"],
      },
      tierReclassification: undefined,
    });
  }

  // DE / CN: contract reports player-ready; keep economy-preview access (not auto-open).
  for (const entityId of ["DE", "CN"] as const) {
    const entry = byId.get(entityId);
    if (!entry) continue;
    byId.set(entityId, {
      ...entry,
      simulationTier: "full-autonomous",
      readiness: {
        autonomous: "ready",
        player: "ready",
        hardBlockers: [],
        flavorGaps: ["bespokeEvents", "artAssets", "wikiMaterial"],
      },
    });
  }

  for (const plan of TIER1_1953_UNCONFIGURED_PROPOSED) {
    if (byId.has(plan.entityId)) {
      throw new Error(`Unconfigured proposed Tier-1 entity ${plan.entityId} already exists.`);
    }
    const hardBlockers = UNCONFIGURED_BLOCKER_CAPABILITIES.map((capabilityId) =>
      formatCapabilityBlocker(
        capabilityId,
        plan.reason,
        tier1FollowUpIssue(plan.entityId, capabilityId)
      )
    );
    hardBlockers[1] = formatCapabilityBlocker(
      UNCONFIGURED_BLOCKER_CAPABILITIES[1],
      plan.reason,
      plan.ownerIssue
    );
    const unconfiguredRegion: Record<string, WorldEntityRegion> = {
      IN: "asia",
      PK: "asia",
      IR: "asia",
      IQ: "asia",
      EG: "africa",
      SA: "asia",
      SY: "asia",
      ID: "asia",
      KP: "asia",
      KR: "asia",
      NVN: "asia",
      SVN: "asia",
    };
    const unconfiguredUn: Record<string, WorldEntityUnRecord> = {
      IN: { state: "admitted", memberSinceYear: 1945 },
      PK: { state: "admitted", memberSinceYear: 1947 },
      IR: { state: "admitted", memberSinceYear: 1945 },
      IQ: { state: "admitted", memberSinceYear: 1945 },
      EG: { state: "admitted", memberSinceYear: 1945 },
      SA: { state: "admitted", memberSinceYear: 1945 },
      SY: { state: "admitted", memberSinceYear: 1945 },
      ID: { state: "admitted", memberSinceYear: 1950 },
      KP: { state: "ineligible" },
      KR: { state: "ineligible" },
      NVN: { state: "ineligible" },
      SVN: { state: "ineligible" },
    };
    const unconfiguredMap: Record<string, string[]> = {
      IN: ["356"],
      PK: ["586"],
      IR: ["364"],
      IQ: ["368"],
      EG: ["818"],
      SA: ["682"],
      SY: ["760"],
      ID: ["360"],
      KP: ["408"],
      KR: ["410"],
      // Entity keys, not ISO numerics: unified Vietnam's 704 covers both halves
      // and so can identify neither. `vietnam-regions.json` supplies these two,
      // cut at the 17th parallel — before it existed both were `unmapped` and
      // the globe drew Vietnam as an uncoloured background country.
      NVN: ["NVN"],
      SVN: ["SVN"],
    };
    byId.set(plan.entityId, {
      entityId: plan.entityId,
      presetId: "1953-default",
      displayName: plan.displayName,
      status: "sovereign",
      region: unconfiguredRegion[plan.entityId],
      simulationTier: plan.appliedTier,
      economicArchetype: plan.economicArchetype,
      sphere: { canSponsor: false, relationships: [] },
      lifecycle: { transitionRuleIds: [] },
      recognition: { status: "widely-recognized" },
      un: unconfiguredUn[plan.entityId] ?? { state: "eligible" },
      mapFeatureIds: unconfiguredMap[plan.entityId],
      readiness: {
        autonomous: "blocked",
        player: "blocked",
        hardBlockers,
        flavorGaps: [],
      },
      legacyAccess: "hidden",
      legacyStatus: "coming-soon",
      tierReclassification: {
        proposedTier: "full-autonomous",
        appliedTier: plan.appliedTier,
        reason: plan.reason,
        followUpIssues: [
          plan.ownerIssue,
          ...UNCONFIGURED_BLOCKER_CAPABILITIES.map((id) => tier1FollowUpIssue(plan.entityId, id)),
        ],
      },
    });
  }

  return [...byId.values()];
}

export const WORLD_ENTITY_MANIFESTS: Readonly<Record<string, WorldEntityPresetManifest>> =
  Object.freeze({
    "1953-default": defineWorldEntityPresetManifest(
      "1953-default",
      apply1953Tier1MatrixAdjustments([
        ...entriesFromAccess("1953-default", accessMap(COLD_WAR_PLAYER, COLD_WAR_ECONOMY)),
        ...europeanSphereMacroEntries("1953-default"),
        ...asianMiddleEastSphereMacroEntries("1953-default"),
        ...africaAmericasSphereMacroEntries("1953-default"),
        ...emergentDecolonizationEntries("1953-default"),
        ...historicalPresenceEntries("1953-default"),
      ])
    ),
    "1979-default": defineWorldEntityPresetManifest(
      "1979-default",
      entriesFromAccess(
        "1979-default",
        // NG is already in COLD_WAR_ECONOMY; IE remains economy-preview in 1979+.
        // AT/FI/GR are full-autonomous in 1953 (promoted from sphere-macro by
        // europeanSphereMacroEntries' promotion override this pass) and full
        // country entries in every later preset (#3791).
        accessMap(
          COLD_WAR_PLAYER,
          [...COLD_WAR_ECONOMY, "IE", "AT", "FI", "GR"],
          COLD_WAR_HIDDEN_1979
        )
      )
    ),
    "1991-default": defineWorldEntityPresetManifest(
      "1991-default",
      entriesFromAccess("1991-default", accessMap(POST_COLD_WAR_PLAYER, POST_COLD_WAR_ECONOMY))
    ),
    "1999-default": defineWorldEntityPresetManifest(
      "1999-default",
      entriesFromAccess("1999-default", accessMap(POST_COLD_WAR_PLAYER, POST_COLD_WAR_ECONOMY))
    ),
    "2007-default": defineWorldEntityPresetManifest(
      "2007-default",
      entriesFromAccess("2007-default", accessMap(POST_COLD_WAR_PLAYER, POST_COLD_WAR_ECONOMY))
    ),
    "2019-default": defineWorldEntityPresetManifest(
      "2019-default",
      configFallbackEntries("2019-default")
    ),
  });

export function getWorldEntityPresetManifest(presetId: string): WorldEntityPresetManifest {
  const manifest = WORLD_ENTITY_MANIFESTS[presetId];
  if (!manifest) {
    throw new Error(
      `No world entity manifest exists for preset ${presetId}; refusing to use another era.`
    );
  }
  return manifest;
}

export function getWorldEntityOrThrow(
  presetId: string,
  entityId: WorldEntityId
): WorldEntityManifestEntry {
  const entry = getWorldEntityPresetManifest(presetId).entries.find(
    (candidate) => candidate.entityId === entityId
  );
  if (!entry) {
    throw new Error(
      `World entity ${entityId} is not classified for preset ${presetId}; refusing fallback.`
    );
  }
  return entry;
}
