import type { Db } from "mongodb";
import {
  getWorldEntityPresetManifest,
  type WorldEntityManifestEntry,
} from "@/lib/world/worldEntityManifest";

export const WORLD_ENTITY_STATES_COLLECTION = "worldEntityStates";
export const FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION = "federationSettlementApplications";

export interface FederationSettlementApplicationRecord {
  _id: string;
  presetId: string;
  settlementId: string;
  revision: number;
  sourceEntityId: string;
  /** The complete source and successor set published by this application. */
  entityIds: string[];
  status: "applied";
  appliedOnTurn: number;
  appliedAt: Date;
}

export interface RuntimeWorldEntityState {
  _id: string;
  presetId: string;
  entityId: string;
  applicationId: string;
  appliedOnTurn: number;
  entry: WorldEntityManifestEntry;
}

/** An applied receipt must cover every state it claims, at one turn and revision. */
export function validateAppliedEntityStates(
  presetId: string,
  applications: readonly FederationSettlementApplicationRecord[],
  states: readonly RuntimeWorldEntityState[]
): ReadonlySet<string> {
  const byApplication = new Map<string, FederationSettlementApplicationRecord>();
  const expected = new Set<string>();
  const appliedSources = new Set<string>();
  const appliedEntities = new Set<string>();
  for (const application of applications) {
    if (
      application.presetId !== presetId ||
      typeof application.settlementId !== "string" ||
      !application.settlementId.trim() ||
      !Number.isSafeInteger(application.revision) ||
      application.revision < 1 ||
      application._id !== `${presetId}:${application.settlementId}:${application.revision}` ||
      application.status !== "applied" ||
      !Number.isSafeInteger(application.appliedOnTurn) ||
      application.appliedOnTurn < 1 ||
      !Array.isArray(application.entityIds) ||
      application.entityIds.length < 2 ||
      typeof application.sourceEntityId !== "string" ||
      !application.entityIds.includes(application.sourceEntityId) ||
      new Set(application.entityIds).size !== application.entityIds.length ||
      appliedSources.has(application.sourceEntityId) ||
      byApplication.has(application._id)
    )
      throw new Error("Invalid applied federation settlement receipt");
    byApplication.set(application._id, application);
    appliedSources.add(application.sourceEntityId);
    for (const entityId of application.entityIds) {
      if (
        typeof entityId !== "string" ||
        !entityId.trim() ||
        expected.has(`${application._id}:${entityId}`) ||
        appliedEntities.has(entityId)
      )
        throw new Error("Invalid applied federation settlement receipt");
      expected.add(`${application._id}:${entityId}`);
      appliedEntities.add(entityId);
    }
  }
  const found = new Set<string>();
  for (const state of states) {
    const application = byApplication.get(state.applicationId);
    const key = `${state.applicationId}:${state.entityId}`;
    if (
      !application ||
      state.appliedOnTurn !== application.appliedOnTurn ||
      !expected.has(key) ||
      found.has(key)
    )
      throw new Error("Applied federation settlement has mismatched entity states");
    found.add(key);
  }
  if (found.size !== expected.size)
    throw new Error("Applied federation settlement is missing entity states");
  return new Set(byApplication.keys());
}

/** A runtime state can replace only the matching entity in its opening preset. */
export function overlayRuntimeWorldEntities(
  presetId: string,
  states: readonly RuntimeWorldEntityState[],
  appliedApplicationIds: ReadonlySet<string>
): WorldEntityManifestEntry[] {
  const opening = getWorldEntityPresetManifest(presetId).entries;
  const byId = new Map(opening.map((entry) => [entry.entityId, entry]));
  const seen = new Set<string>();
  for (const state of states) {
    if (
      state.presetId !== presetId ||
      state.entry.presetId !== presetId ||
      state.entityId !== state.entry.entityId ||
      state._id !== `${presetId}:${state.entityId}` ||
      !appliedApplicationIds.has(state.applicationId) ||
      !Number.isSafeInteger(state.appliedOnTurn) ||
      state.appliedOnTurn < 1 ||
      !byId.has(state.entityId) ||
      seen.has(state.entityId)
    ) {
      throw new Error("Invalid runtime world entity state");
    }
    seen.add(state.entityId);
    byId.set(state.entityId, state.entry);
  }
  return [...byId.values()];
}

export async function loadRuntimeWorldEntities(
  db: Db,
  presetId: string
): Promise<WorldEntityManifestEntry[]> {
  const applications = await db
    .collection<FederationSettlementApplicationRecord>(
      FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION
    )
    .find(
      { presetId, status: "applied" },
      {
        projection: {
          _id: 1,
          presetId: 1,
          settlementId: 1,
          revision: 1,
          sourceEntityId: 1,
          entityIds: 1,
          status: 1,
          appliedOnTurn: 1,
        },
      }
    )
    .toArray();
  if (applications.length === 0) return overlayRuntimeWorldEntities(presetId, [], new Set());
  const appliedIds = applications.map((application) => application._id);
  const states = await db
    .collection<RuntimeWorldEntityState>(WORLD_ENTITY_STATES_COLLECTION)
    .find({ presetId, applicationId: { $in: appliedIds } })
    .toArray();
  return overlayRuntimeWorldEntities(
    presetId,
    states,
    validateAppliedEntityStates(presetId, applications, states)
  );
}
