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
    .find({ presetId, status: "applied" }, { projection: { _id: 1 } })
    .toArray();
  if (applications.length === 0) return overlayRuntimeWorldEntities(presetId, [], new Set());
  const appliedIds = new Set(applications.map((application) => application._id));
  const states = await db
    .collection<RuntimeWorldEntityState>(WORLD_ENTITY_STATES_COLLECTION)
    .find({ presetId, applicationId: { $in: [...appliedIds] } })
    .toArray();
  return overlayRuntimeWorldEntities(presetId, states, appliedIds);
}
