"use client";
import { useReducer, useCallback, useEffect } from "react";
import type { EditorStateConfig } from "@/lib/positionEditor/types";
import { saveOverride } from "@/lib/positionEditor/storage";

interface State {
  config: EditorStateConfig | null;
  dirty: boolean;
}
type Action =
  | { type: "LOAD"; config: EditorStateConfig }
  | {
      type: "SET_LAYER1";
      dim: string;
      key: string;
      field: "share" | "turnout" | "economicLean" | "socialLean";
      value: number;
    }
  | { type: "SET_WEIGHT"; archetypeId: string; index: number; value: number }
  | { type: "ADD_WEIGHT"; archetypeId: string; dim: string; key: string }
  | { type: "REMOVE_WEIGHT"; archetypeId: string; index: number }
  | { type: "SET_CIVIC"; archetypeId: string; value: number }
  | { type: "SAVED" };

function reducer(state: State, action: Action): State {
  if (action.type === "LOAD") return { config: action.config, dirty: false };
  if (action.type === "SAVED") return { ...state, dirty: false };
  if (!state.config) return state;
  const cfg = structuredClone(state.config);
  switch (action.type) {
    case "SET_LAYER1":
      cfg.layer1[action.dim][action.key][action.field] = action.value;
      break;
    case "SET_WEIGHT":
      cfg.archetypes.find((a) => a.id === action.archetypeId)!.weights[action.index].w =
        action.value;
      break;
    case "ADD_WEIGHT": {
      const a = cfg.archetypes.find((x) => x.id === action.archetypeId)!;
      if (!a.weights.some((w) => w.dim === action.dim && w.key === action.key)) {
        a.weights.push({ dim: action.dim, key: action.key, w: 0.1 });
      }
      break;
    }
    case "REMOVE_WEIGHT":
      cfg.archetypes.find((a) => a.id === action.archetypeId)!.weights.splice(action.index, 1);
      break;
    case "SET_CIVIC":
      cfg.archetypes.find((a) => a.id === action.archetypeId)!.civicMultiplier = action.value;
      break;
  }
  return { config: cfg, dirty: true };
}

export function usePositionEditorState() {
  const [state, dispatch] = useReducer(reducer, { config: null, dirty: false });

  // Debounced auto-save to localStorage whenever dirty.
  useEffect(() => {
    if (!state.dirty || !state.config) return;
    const cfg = state.config;
    const t = setTimeout(() => {
      saveOverride(cfg);
      dispatch({ type: "SAVED" });
    }, 250);
    return () => clearTimeout(t);
  }, [state.dirty, state.config]);

  const load = useCallback((config: EditorStateConfig) => dispatch({ type: "LOAD", config }), []);
  return { state, dispatch, load };
}
