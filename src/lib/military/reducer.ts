import type { MilitaryState, CommandPosture } from "./types";
import { createCommand, type CommandDraft } from "./commands";
import { REGION_CAP } from "./config";
import { STRATEGIC_REGIONS } from "./regions";

export type MilitaryAction =
  | { type: "SELECT"; commandId: string }
  | { type: "SET_FILTER"; filter: string }
  | { type: "CLICK_REGION"; regionId: string }
  | { type: "CLOSE_REGION" }
  | { type: "TOGGLE_REGION"; commandId: string; regionId: string }
  | { type: "REMOVE_REGION"; commandId: string; regionId: string }
  | { type: "TOGGLE_ASSIGN_MODE" }
  | { type: "ADD_COMMANDER"; commandId: string; commanderId: string }
  | { type: "REMOVE_COMMANDER"; commandId: string; commanderId: string }
  | { type: "SET_COMMANDING_GENERAL"; commandId: string; commanderId: string | null }
  | { type: "SET_POSTURE"; commandId: string; posture: CommandPosture }
  | { type: "ASSIGN_UNIT"; commandId: string; unitId: string }
  | { type: "UNASSIGN_UNIT"; commandId: string; unitId: string }
  | { type: "STAND_DOWN"; commandId: string }
  | { type: "AUTO_ASSIGN" }
  | { type: "CREATE_COMMAND"; draft: CommandDraft };

/** Fresh empty state — commands are seeded from persisted per-country data by the page. */
export function initialMilitaryState(): MilitaryState {
  return {
    commands: [],
    selectedId: null,
    selectedRegionId: null,
    filter: "coverage",
    assignMode: false,
  };
}

export function militaryReducer(state: MilitaryState, action: MilitaryAction): MilitaryState {
  switch (action.type) {
    case "SELECT":
      return { ...state, selectedId: action.commandId, selectedRegionId: null, assignMode: false };

    case "SET_FILTER":
      return { ...state, filter: action.filter };

    case "CLICK_REGION":
      if (state.assignMode && state.selectedId) {
        return militaryReducer(state, {
          type: "TOGGLE_REGION",
          commandId: state.selectedId,
          regionId: action.regionId,
        });
      }
      return { ...state, selectedRegionId: action.regionId };

    case "CLOSE_REGION":
      return { ...state, selectedRegionId: null };

    case "TOGGLE_REGION": {
      const cc = state.commands.find((c) => c.id === action.commandId);
      // Respect the per-command region cap when adding (removal always allowed).
      if (cc && !cc.regionIds.includes(action.regionId) && cc.regionIds.length >= REGION_CAP) {
        return state;
      }
      return {
        ...state,
        commands: state.commands.map((c) => {
          if (c.id !== action.commandId) return c;
          const has = c.regionIds.includes(action.regionId);
          return {
            ...c,
            regionIds: has
              ? c.regionIds.filter((x) => x !== action.regionId)
              : [...c.regionIds, action.regionId],
          };
        }),
      };
    }

    case "REMOVE_REGION":
      return {
        ...state,
        commands: state.commands.map((c) =>
          c.id === action.commandId
            ? { ...c, regionIds: c.regionIds.filter((x) => x !== action.regionId) }
            : c
        ),
      };

    case "TOGGLE_ASSIGN_MODE":
      return { ...state, assignMode: !state.assignMode, selectedRegionId: null };

    case "ADD_COMMANDER":
      return {
        ...state,
        commands: state.commands.map((c) =>
          c.id === action.commandId && !c.commanderIds.includes(action.commanderId)
            ? { ...c, commanderIds: [...c.commanderIds, action.commanderId] }
            : c
        ),
      };

    case "REMOVE_COMMANDER":
      return {
        ...state,
        commands: state.commands.map((c) =>
          c.id === action.commandId
            ? {
                ...c,
                commanderIds: c.commanderIds.filter((x) => x !== action.commanderId),
                // A general who has left the command cannot keep leading it.
                commandingGeneralId:
                  c.commandingGeneralId === action.commanderId ? null : c.commandingGeneralId,
              }
            : c
        ),
      };

    case "SET_COMMANDING_GENERAL": {
      // One command per Commanding General. The CG's own page resolves their command
      // by first match, so a general leading two could operate only one — the other
      // command's generals would be unpostable and its units would never reach a
      // front. The API refuses this too; refusing here means the Secretary never
      // builds a state they cannot save.
      const leadsElsewhere =
        action.commanderId !== null &&
        state.commands.some(
          (c) => c.id !== action.commandId && c.commandingGeneralId === action.commanderId
        );
      if (leadsElsewhere) return state;
      return {
        ...state,
        commands: state.commands.map((c) => {
          if (c.id !== action.commandId) return c;
          // Only a member of this command may lead it; null always clears.
          if (action.commanderId !== null && !c.commanderIds.includes(action.commanderId)) {
            return c;
          }
          return { ...c, commandingGeneralId: action.commanderId };
        }),
      };
    }

    case "SET_POSTURE":
      return {
        ...state,
        commands: state.commands.map((c) =>
          c.id === action.commandId ? { ...c, posture: action.posture } : c
        ),
      };

    case "ASSIGN_UNIT":
      return {
        ...state,
        commands: state.commands.map((c) => {
          if (c.id === action.commandId) {
            return c.unitIds.includes(action.unitId)
              ? c
              : { ...c, unitIds: [...c.unitIds, action.unitId] };
          }
          // one-command-per-unit: pull it out of any other command
          return c.unitIds.includes(action.unitId)
            ? { ...c, unitIds: c.unitIds.filter((id) => id !== action.unitId) }
            : c;
        }),
      };

    case "UNASSIGN_UNIT":
      return {
        ...state,
        commands: state.commands.map((c) =>
          c.id === action.commandId
            ? { ...c, unitIds: c.unitIds.filter((id) => id !== action.unitId) }
            : c
        ),
      };

    case "STAND_DOWN": {
      const rest = state.commands.filter((c) => c.id !== action.commandId);
      return {
        ...state,
        commands: rest,
        selectedId:
          state.selectedId === action.commandId ? (rest[0]?.id ?? null) : state.selectedId,
      };
    }

    case "AUTO_ASSIGN": {
      // For each uncovered region, pick the REGIONAL/HOMELAND_DEFENSE command with
      // the fewest regions that still has headroom under the region cap (mockup autoAssign).
      const commands = state.commands.map((c) => ({ ...c, regionIds: [...c.regionIds] }));
      const covered = new Set(commands.flatMap((c) => c.regionIds));
      for (const r of STRATEGIC_REGIONS) {
        if (covered.has(r.id)) continue;
        const cand = commands
          .filter(
            (c) =>
              (c.type === "REGIONAL" || c.type === "HOMELAND_DEFENSE") &&
              c.regionIds.length < REGION_CAP
          )
          .sort((a, b) => a.regionIds.length - b.regionIds.length)[0];
        if (cand) {
          cand.regionIds.push(r.id);
          covered.add(r.id);
        }
      }
      return { ...state, commands };
    }

    case "CREATE_COMMAND": {
      const { command } = createCommand(action.draft, state.commands);
      // Enforce one-command-per-commander: pull chosen commanders out of prior commands.
      const commands = action.draft.commanderIds.length
        ? state.commands.map((c) => {
            const kept = c.commanderIds.filter((x) => !action.draft.commanderIds.includes(x));
            return {
              ...c,
              commanderIds: kept,
              // A command that just lost its lead to the new command has no CG.
              commandingGeneralId:
                c.commandingGeneralId && kept.includes(c.commandingGeneralId)
                  ? c.commandingGeneralId
                  : null,
            };
          })
        : state.commands;
      return { ...state, commands: [...commands, command], selectedId: command.id };
    }

    default:
      return state;
  }
}
