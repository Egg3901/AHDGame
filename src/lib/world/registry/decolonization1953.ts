/**
 * 1953 decolonization, dependency and sphere-macro entity builders.
 *
 * Extracted from `worldEntityManifest.ts` when it crossed the repo's 2000 LOC
 * architecture cap. The block is self-contained: it references no runtime value
 * from its former home, only types, so the dependency stays one-directional
 * (`worldEntityManifest` imports from here) with no module cycle at init time —
 * which matters, because `WORLD_ENTITY_MANIFESTS` is built at module load.
 *
 * This is the authored 1953 world outside the CountryConfig domain: emergent
 * decolonization targets, colonial dependencies, and the sphere-macro entities
 * that carry sponsor relationships.
 */
import type { CountryId } from "@/lib/constants/countries";
import type {
  WorldEconomicArchetype,
  WorldEntityId,
  WorldEntityManifestEntry,
  WorldEntityRecognition,
  WorldEntityRegion,
  WorldEntityRelationship,
  WorldEntityUnRecord,
  WorldExceptionalStatus,
} from "../worldEntityManifest";

/**
 * Readiness blocker strings. Defined here rather than in `worldEntityManifest`
 * because `SPHERE_MACRO_BLOCKERS` below needs them and the import runs
 * manifest -> here; the manifest re-imports them so there is one definition on
 * this path instead of two. (`registry/builders.ts` and `transitions/apply.ts`
 * still carry their own copies.)
 */
export const PLAYER_BLOCKER = "Player access is not enabled for this entity in the active preset.";
export const AUTONOMY_BLOCKER =
  "Autonomous simulation is not enabled for this entity in the active preset.";

const SPHERE_MACRO_BLOCKERS = [
  AUTONOMY_BLOCKER,
  PLAYER_BLOCKER,
  "Sphere-macro countries have no domestic player offices or firm simulation.",
] as const;

export function sphereMacroEntry(args: {
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
export function emergentDecolonizationEntries(presetId: string): WorldEntityManifestEntry[] {
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
      // The modern state outright, so its border is its own.
      mapFeatureIds: ["706"],
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
      // Same territory as `BCO` one stage on; both claim 180, first writer wins.
      mapFeatureIds: ["180"],
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
      // Southern Yemen: no ISO numeric, so `historical-regions.json` supplies it.
      mapFeatureIds: ["YD"],
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
export const HEAD_CLAIMED_1953_ENTITY_IDS: ReadonlySet<string> = new Set([
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
export function decolonizationDependencyEntries(presetId: string): WorldEntityManifestEntry[] {
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
      // BOTH Somalilands as one record, per the note above — which is exactly modern
      // Somalia. Building the Italian south alone would match the name and
      // contradict the definition, dropping the whole north.
      mapFeatureIds: ["706"],
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
      // ⚠️ SHADOWS the asia1953 registry row of the same id, so claiming the
      // feature only there had no effect. Geometry: `historical-regions.json`.
      mapFeatureIds: ["ADN"],
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
