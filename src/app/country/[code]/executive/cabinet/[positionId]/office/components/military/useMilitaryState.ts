"use client";

import { useMemo, useReducer, type Dispatch } from "react";
import { useDebouncedSave } from "@/hooks/useDebouncedSave";
import { militaryReducer, type MilitaryAction } from "@/lib/military/reducer";
import { dedupeCommandIds } from "@/lib/military/commands";
import type { MilitaryState, MilitaryCommand } from "@/lib/military/types";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";

export interface MilitarySeed {
  commands: MilitaryCommand[];
  units: MilitaryUnit[];
  countryCode: string;
  positionId: string;
}

/**
 * Client state for the SecDef Office Commands tab. Seeds the command org from the
 * persisted per-country commands passed by the server component, resolves
 * `unitIds` → live units for capacity/effectiveness, and persists the command
 * structure (debounced) to the gated PUT on change. Ephemeral UI state
 * (selection / filter / assign mode) stays local.
 */
export function useMilitaryState(seed: MilitarySeed): {
  state: MilitaryState;
  dispatch: Dispatch<MilitaryAction>;
  unitsById: Record<string, MilitaryUnit>;
  pool: MilitaryUnit[];
  /** Server's reason for refusing the last autosave; null while saves succeed. */
  saveError: string | null;
} {
  const [state, dispatch] = useReducer(militaryReducer, seed, (s): MilitaryState => {
    // Heal colliding ids before anything selects or dispatches against them. Command
    // ids used to come from a counter that reset each page load, so an org built over
    // two sessions can arrive with two commands sharing an id — which highlights both
    // rows, opens the wrong one, and makes every commandId action edit both.
    const commands = dedupeCommandIds(s.commands);
    return {
      commands,
      selectedId: commands[0]?.id ?? null,
      selectedRegionId: null,
      filter: "coverage",
      assignMode: false,
    };
  });

  const unitsById = useMemo(
    () => Object.fromEntries(seed.units.map((u) => [String(u._id), u])),
    [seed.units]
  );
  const assigned = useMemo(
    () => new Set(state.commands.flatMap((c) => c.unitIds)),
    [state.commands]
  );
  const pool = useMemo(
    () => seed.units.filter((u) => !assigned.has(String(u._id))),
    [seed.units, assigned]
  );

  // Persist the command org (debounced) whenever it changes, after the initial seed.
  // Countries with no defense seat have no position to gate the write on → read-only.
  const saveError = useDebouncedSave(
    `/api/country/${seed.countryCode}/executive/cabinet/${seed.positionId}/commands`,
    { commands: state.commands },
    !!seed.positionId,
    "Command changes could not be saved."
  );

  return { state, dispatch, unitsById, pool, saveError };
}
