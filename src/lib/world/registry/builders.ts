import type {
  WorldEntityManifestEntry,
  WorldEntityRegion,
  WorldEntityRecognition,
  WorldEntityUnRecord,
  WorldEconomicArchetype,
  WorldEntityLifecycle,
  WorldEntityStatus,
  WorldEntityId,
} from "@/lib/world/worldEntityManifest";

const AUTONOMY_BLOCKER =
  "The entity is not wired for a full autonomous country simulation in this preset.";
const PLAYER_BLOCKER = "Player access is not enabled for this entity in the active preset.";
const TIER3_BLOCKER =
  "Historical-presence (Tier-3) entities have no domestic player offices or firm simulation.";
const DEPENDENT_BLOCKER = "Dependencies have no independent sphere or domestic player simulation.";

export interface Tier3EntryInput {
  entityId: WorldEntityId;
  displayName: string;
  region: WorldEntityRegion;
  status: WorldEntityStatus;
  parentEntityId?: WorldEntityId;
  /**
   * Contested / mandate / condominium cases that are not ordinary dependencies.
   * Required when status is dependent-like without a clean metropolitan parent,
   * or when sovereignty is disputed (e.g. Taiwan).
   */
  exceptionalStatus?: WorldEntityManifestEntry["exceptionalStatus"];
  recognition: WorldEntityRecognition;
  un: WorldEntityUnRecord;
  lifecycle?: Partial<WorldEntityLifecycle>;
  /** Natural Earth ISO numeric proxies; omitted → unmapped until geometry authored. */
  mapFeatureIds?: string[];
  economicArchetype?: WorldEconomicArchetype;
  /** Free-form author notes for approximations (kept out of runtime UI). */
  notes?: string;
  transitionRuleIds?: string[];
}

/**
 * Build a Tier-3 historical-presence manifest row with blocked readiness.
 * Keeps the deep-module surface small: callers supply identity + status fields only.
 */
export function tier3Entry(presetId: string, input: Tier3EntryInput): WorldEntityManifestEntry {
  const isDependent = input.status === "dependent";
  const hardBlockers = [
    AUTONOMY_BLOCKER,
    PLAYER_BLOCKER,
    isDependent ? DEPENDENT_BLOCKER : TIER3_BLOCKER,
  ];

  return {
    entityId: input.entityId,
    presetId,
    displayName: input.displayName,
    status: input.status,
    parentEntityId: input.parentEntityId,
    exceptionalStatus: input.exceptionalStatus,
    region: input.region,
    simulationTier: "historical-presence",
    economicArchetype: input.economicArchetype ?? "none",
    sphere: { canSponsor: false, relationships: [] },
    lifecycle: {
      earliestYear: input.lifecycle?.earliestYear,
      expectedYear: input.lifecycle?.expectedYear,
      latestYear: input.lifecycle?.latestYear,
      transitionRuleIds: input.transitionRuleIds ?? input.lifecycle?.transitionRuleIds ?? [],
    },
    recognition: input.recognition,
    un: input.un,
    mapFeatureIds: input.mapFeatureIds,
    readiness: {
      autonomous: "blocked",
      player: "blocked",
      hardBlockers,
      flavorGaps: input.notes ? [input.notes] : [],
    },
    legacyAccess: "hidden",
    legacyStatus: "coming-soon",
  };
}

export function unMember(memberSinceYear: number): WorldEntityUnRecord {
  return { state: "admitted", memberSinceYear };
}

export function unIneligible(expectedAdmissionYear?: number): WorldEntityUnRecord {
  return { state: "ineligible", expectedAdmissionYear };
}

export function unEligible(expectedAdmissionYear?: number): WorldEntityUnRecord {
  return { state: "eligible", expectedAdmissionYear };
}

export function recognized(notes?: string): WorldEntityRecognition {
  return { status: "widely-recognized", notes };
}

export function partialRecognition(notes: string): WorldEntityRecognition {
  return { status: "partial", notes };
}

export function contestedRecognition(notes: string): WorldEntityRecognition {
  return { status: "contested", notes };
}

export function dependentRecognition(notes?: string): WorldEntityRecognition {
  return { status: "dependent", notes };
}
