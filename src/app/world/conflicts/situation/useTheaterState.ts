"use client";

import { useReducer, type Dispatch } from "react";
import { useDebouncedSave } from "@/hooks/useDebouncedSave";

export interface TheaterState {
  country: string;
  cohesion: number;
  sel: string;
  committed: Record<string, number>;
  pool: number;
}

export type TheaterAction =
  | { type: "SELECT"; id: string }
  | { type: "SET_COMMITTED"; id: string; v: number }
  | { type: "COMMIT_ALL"; id: string }
  | { type: "WITHDRAW"; id: string }
  | { type: "SET_COHESION"; v: number };

/** CP already committed to theaters other than `id`. */
function othersTotal(state: TheaterState, id: string): number {
  return Object.entries(state.committed).reduce(
    (a, [k, v]) => (k === id ? a : a + Math.max(0, v)),
    0
  );
}

export function theaterReducer(state: TheaterState, action: TheaterAction): TheaterState {
  switch (action.type) {
    case "SELECT":
      return { ...state, sel: action.id };
    case "SET_COMMITTED": {
      // Cannot commit more than the pool minus what other theaters already hold.
      const maxV = Math.max(0, state.pool - othersTotal(state, action.id));
      const val = Math.max(0, Math.min(maxV, Math.round(action.v)));
      return { ...state, committed: { ...state.committed, [action.id]: val } };
    }
    case "COMMIT_ALL":
      return {
        ...state,
        committed: {
          ...state.committed,
          [action.id]: Math.max(0, state.pool - othersTotal(state, action.id)),
        },
      };
    case "WITHDRAW":
      return { ...state, committed: { ...state.committed, [action.id]: 0 } };
    case "SET_COHESION":
      return { ...state, cohesion: Math.max(40, Math.min(100, Math.round(action.v))) };
    default:
      return state;
  }
}

export interface TheaterSeed {
  country: string;
  countryCode: string;
  positionId: string;
  cohesion: number;
  committed: Record<string, number>;
  pool: number;
}

/**
 * World Situation Board state for a country, seeded from server props and persisted
 * (debounced) via the gated theaters PUT. The committable pool derives from the
 * country's live units; `cohesion` + `committed` are the persisted player decisions.
 * Read-only when the viewer's country has no defense seat (`positionId` empty).
 */
export function useTheaterState(seed: TheaterSeed): {
  state: TheaterState;
  dispatch: Dispatch<TheaterAction>;
  /** Server's reason for refusing the last autosave; null while saves succeed. */
  saveError: string | null;
} {
  const [state, dispatch] = useReducer(theaterReducer, seed, (s): TheaterState => ({
    country: s.country,
    cohesion: s.cohesion,
    // No conflict selected until one is created (conflicts start empty).
    sel: "",
    committed: s.committed,
    pool: s.pool,
  }));

  // Persist { cohesion, committed } (debounced) after the initial seed; skip when the
  // viewer holds no defense seat.
  const saveError = useDebouncedSave(
    `/api/country/${seed.countryCode}/executive/cabinet/${seed.positionId}/theaters`,
    { cohesion: state.cohesion, committed: state.committed },
    !!seed.positionId,
    "Theater changes could not be saved."
  );

  return { state, dispatch, saveError };
}
