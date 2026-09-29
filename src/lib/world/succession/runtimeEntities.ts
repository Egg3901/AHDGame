import type { Db } from "mongodb";
import {
  getWorldEntityPresetManifest,
  type WorldEntityManifestEntry,
} from "@/lib/world/worldEntityManifest";

export const WORLD_ENTITY_STATES_COLLECTION = "worldEntityStates";

export interface RuntimeWorldEntityState {
  _id: string;
  presetId: string;
  entityId: string;
  settlementId: string;
  appliedOnTurn: number;
  entry: WorldEntityManifestEntry;
}

/** A runtime state can replace only the matching entity in its opening preset. */
export function overlayRuntimeWorldEntities(
  presetId: string,
  states: readonly RuntimeWorldEntityState[]
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
      !state.settlementId.trim() ||
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
  const states = await db
    .collection<RuntimeWorldEntityState>(WORLD_ENTITY_STATES_COLLECTION)
    .find({ presetId })
    .toArray();
  return overlayRuntimeWorldEntities(presetId, states);
}
