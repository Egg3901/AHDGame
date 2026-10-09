import type { ResetCountry } from "@/lib/resetLegislation/fundingOwner";
import type { ActionUseHistory, ActiveCabinetAction, CabinetActorActionState } from "./actions";
import { RESET_V2_OPENING_COUNTRIES } from "@/lib/resetVersions/rules";

/** World-bound persistence envelope for the portable ministerial-action rules. */
export interface ResetCabinetActionState {
  _id: ResetCountry;
  worldId: string;
  countryId: ResetCountry;
  sourceTurn: number;
  actorStates: Record<string, CabinetActorActionState>;
  active: ActiveCabinetAction[];
  history: ActionUseHistory[];
  updatedTurn: number;
}

export function openingCabinetActionStates(
  worldId: string,
  sourceTurn: number
): ResetCabinetActionState[] {
  if (!worldId || !Number.isSafeInteger(sourceTurn) || sourceTurn < 1) {
    throw new Error("Cabinet action opening requires a world and source turn");
  }
  return RESET_V2_OPENING_COUNTRIES.map((countryId) => ({
    _id: countryId,
    worldId,
    countryId,
    sourceTurn,
    actorStates: {},
    active: [],
    history: [],
    updatedTurn: sourceTurn,
  }));
}

export function cabinetActionStatesPayload(rows: readonly ResetCabinetActionState[]): string {
  const ids = new Set<string>();
  return JSON.stringify(
    [...rows]
      .sort((a, b) => a._id.localeCompare(b._id))
      .map((row) => {
        if (
          ids.has(row._id) ||
          row._id !== row.countryId ||
          !row.worldId ||
          !Number.isSafeInteger(row.sourceTurn) ||
          row.sourceTurn < 1 ||
          row.updatedTurn !== row.sourceTurn ||
          Object.keys(row.actorStates).length > 0 ||
          row.active.length > 0 ||
          row.history.length > 0
        ) {
          throw new Error(`Invalid opening Cabinet action state ${row._id}`);
        }
        ids.add(row._id);
        return [row._id, row.worldId, row.countryId, row.sourceTurn, row.updatedTurn];
      })
  );
}
