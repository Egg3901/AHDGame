"use client";

import { useReducer, useState, type Dispatch } from "react";
import type { ProfileGeneral } from "@/lib/military/generalsTree";

export interface CharacterSubject {
  id: string;
  name: string;
  chop?: string;
  /** Lowercased country code, for links into the country's military surfaces. */
  countryCode?: string;
}

export interface GeneralState {
  general: ProfileGeneral | null; // null when the character is not commissioned
  tab: string;
  selTraitId: string | null;
  /** Server's reason for refusing the last training attempt; null once one succeeds. */
  error: string | null;
}

export type GeneralAction =
  | { type: "SET_TAB"; tab: string }
  | { type: "SELECT_TRAIT"; id: string | null }
  | { type: "TRAIN"; id: string };

interface UiState {
  tab: string;
  selTraitId: string | null;
}
function uiReducer(s: UiState, a: GeneralAction): UiState {
  if (a.type === "SET_TAB") return { tab: a.tab, selTraitId: null };
  if (a.type === "SELECT_TRAIT") return { ...s, selTraitId: a.id };
  return s;
}

/**
 * Per-character general state for the Military tab. The general is seeded from the
 * live per-character record fetched by the server component (null when the character
 * is not a commissioned general). `TRAIN` posts to the self-only, server-authoritative
 * route and reflects the returned general; tab/trait selection stay local. The adopted
 * national doctrine (for trait "boost" glow) is passed in from live data.
 *
 * A refused train surfaces the server's reason rather than failing silently: the
 * route rejects for reasons the player cannot see from the tree alone (not enough
 * points, node unavailable, era-gated, commission revoked), so swallowing the
 * response would leave a click that simply does nothing.
 */
export function useCharacterGeneral(
  subject: CharacterSubject,
  adopted: Record<string, number>,
  seedGeneral: ProfileGeneral | null
): {
  state: GeneralState;
  dispatch: Dispatch<GeneralAction>;
  adopted: Record<string, number>;
} {
  const [general, setGeneral] = useState<ProfileGeneral | null>(seedGeneral);
  const [error, setError] = useState<string | null>(null);
  const [ui, uiDispatch] = useReducer(uiReducer, { tab: "overview", selTraitId: null });

  const post = async (path: string, body: unknown): Promise<void> => {
    try {
      const res = await fetch(`/api/character/${subject.id}/general/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Could not train that trait.");
        return;
      }
      const data = (await res.json()) as { general: ProfileGeneral };
      setGeneral(data.general);
      setError(null);
    } catch {
      setError("Could not train that trait.");
    }
  };

  const dispatch: Dispatch<GeneralAction> = (action) => {
    if (action.type === "TRAIN") {
      void post("train", { nodeId: action.id });
    } else {
      uiDispatch(action);
    }
  };

  const state: GeneralState = { general, tab: ui.tab, selTraitId: ui.selTraitId, error };
  return { state, dispatch, adopted };
}
