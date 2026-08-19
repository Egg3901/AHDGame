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
