"use client";

import { useMemo, useReducer, type Dispatch } from "react";
import { useDebouncedSave } from "@/hooks/useDebouncedSave";
import { militaryReducer, type MilitaryAction } from "@/lib/military/reducer";
import { dedupeCommandIds, reconcileCommandCommanders } from "@/lib/military/commands";
import type { MilitaryState, MilitaryCommand } from "@/lib/military/types";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";

export interface MilitarySeed {
  commands: MilitaryCommand[];
  units: MilitaryUnit[];
  /**
   * The country's commissioned generals — the only ids a command may list. Omitted
   * means "do not reconcile", which is what a caller without the roster to hand
   * must say rather than silently emptying every command.
   */
  commanderIds?: string[];
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
  /**
   * Commanders dropped at seed time because they are no longer commissioned
   * generals of this country. Zero on a clean org.
   */
  droppedCommanders: number;
} {
  const [state, dispatch] = useReducer(militaryReducer, seed, (s): MilitaryState => {
    // Heal colliding ids before anything selects or dispatches against them. Command
    // ids used to come from a counter that reset each page load, so an org built over
    // two sessions can arrive with two commands sharing an id — which highlights both
    // rows, opens the wrong one, and makes every commandId action edit both.
    //
    // Then drop commanders who have left the country or been dismissed. The saved
    // org keeps their character id, the panel cannot render a row for someone the
    // roster no longer holds, and the PUT rejects the whole array over that id — so
    // without this the command becomes permanently unsavable with nothing on screen
    // to remove. See reconcileCommandCommanders.
    const commands = s.commanderIds
      ? reconcileCommandCommanders(dedupeCommandIds(s.commands), s.commanderIds).commands
      : dedupeCommandIds(s.commands);
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

  // Counted against the SEED, not against live state: once the Secretary starts
  // editing, `state.commands` no longer carries the stale ids, and the notice has
  // to keep explaining why the roster it loaded is shorter than it was.
  const droppedCommanders = useMemo(
    () =>
      seed.commanderIds ? reconcileCommandCommanders(seed.commands, seed.commanderIds).removed : 0,
    [seed.commands, seed.commanderIds]
  );

  return { state, dispatch, unitsById, pool, saveError, droppedCommanders };
}
