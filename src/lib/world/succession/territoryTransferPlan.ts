import type { ClientSession, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { State } from "@/lib/db/types/state";
import type { SuccessorTerritory } from "./rules/territory";
import { buildSourceRegionHierarchy } from "./sourceRegionHierarchy";

export interface FederationStateTransferPlan {
  stateId: string;
  parentRegionId: string | null;
  topLevelRegionId: string;
  successorEntityId: string;
  /** The detailed source retains only territory assigned to itself. */
  leavesDetailedSource: boolean;
}

/** Partition every nested live state, not just the top-level regions on the
 * political mandate. This plan is frozen with the approved live snapshot; it
 * has no effect before the complete settlement is published. */
export async function planLiveFederationStateTransfers(input: {
  db: Db;
  sourceCountryId: CountryId;
  territories: readonly SuccessorTerritory[];
  session?: ClientSession;
}): Promise<FederationStateTransferPlan[]> {
  const { db, sourceCountryId, territories, session } = input;
  const states = await db
    .collection<State>("states")
    .find({ countryId: sourceCountryId }, { session })
    .toArray();
  const { topLevel, topLevelFor } = buildSourceRegionHierarchy(states);
  const owners = new Map<string, string>();
  for (const territory of territories) {
    if (!territory.entityId) throw new Error("Federation territory has no successor");
    for (const regionId of territory.regionIds) {
      if (!regionId || owners.has(regionId))
        throw new Error("Federation territory assigns a region twice");
      owners.set(regionId, territory.entityId);
    }
  }
  if (topLevel.length !== owners.size || topLevel.some((state) => !owners.has(state._id)))
    throw new Error("Federation territory does not cover every live top-level region");
  return states
    .map((state) => {
      const topLevelRegionId = topLevelFor(state._id);
      const successorEntityId = topLevelRegionId ? owners.get(topLevelRegionId) : undefined;
      if (!topLevelRegionId || !successorEntityId)
        throw new Error("Federation nested state has no approved successor");
      return {
        stateId: state._id,
        parentRegionId: state.parentRegionId ?? null,
        topLevelRegionId,
        successorEntityId,
        leavesDetailedSource: successorEntityId !== sourceCountryId,
      };
    })
    .sort((a, b) => a.stateId.localeCompare(b.stateId));
}
