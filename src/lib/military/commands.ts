import type {
  CommandType,
  CommandPosture,
  SupplyPriority,
  MilitaryCommand,
  MilitaryOperation,
  MilitaryState,
} from "./types";
import { COMMAND_TYPES, REGION_CAP } from "./config";
import { getRegion } from "./regions";
import { draftEffectiveness } from "./calc";

export interface CommandDraft {
  name: string;
  type: CommandType;
  regionIds: string[];
  commanderIds: string[];
  /** Intended lead; falls back to the first chosen commander when unset. */
  commandingGeneralId: string | null;
  posture: CommandPosture;
  supply: SupplyPriority;
}

// Commands start empty per country — the defense minister builds the structure
// (the US-flavored mockup seed was retired in the W3 wiring). Kept as an exported
// empty array so any residual importer still type-checks.
export const SEED_COMMANDS: MilitaryCommand[] = [];

// Operations are display-only flavor; wired into the turn system in a later
// sub-project (W6). Empty until then.
export const SEED_OPERATIONS: MilitaryOperation[] = [];

/**
 * All 12 postures are currently valid for every command type. Reserved hook for
 * future per-type restriction (backend spec enumerates postures per type).
 */
export function isPostureValidForType(_type: CommandType, _posture: CommandPosture): boolean {
  return true;
}

function commandsOfRegion(state: MilitaryState, rid: string): MilitaryCommand[] {
  return state.commands.filter((c) => c.regionIds.includes(rid));
}

// Ported from the mockup's draftWarnings().
export function validateDraft(draft: CommandDraft, state: MilitaryState): string[] {
  const w: string[] = [];
  for (const rid of draft.regionIds) {
    const owners = commandsOfRegion(state, rid);
    if (owners.length) w.push(`${getRegion(rid)?.name} is already assigned to ${owners[0].name}.`);
  }
  if (!draft.commanderIds.length) {
    w.push("No commander selected — command efficiency will be reduced by 10%.");
  }
  if (draft.regionIds.length > 4) {
    w.push("Assigned regions exceed the recommended region load (4).");
  }
  const overseasNaval = draft.regionIds.some((rid) => getRegion(rid)?.type === "naval");
  const navalCapable = draft.type === "LOGISTICS";
  if (overseasNaval && !navalCapable) {
    w.push("No naval command structure for an assigned sea region — coverage will be weak.");
  }
  if (draft.regionIds.length >= REGION_CAP && draft.type !== "LOGISTICS") {
    w.push("Logistics command recommended for multi-region overseas sustainment.");
  }
  return w;
}

/**
 * An id no command in `existing` already holds.
 *
 * This was a module-level counter that reset to 0 on every page load and ignored the
 * commands already persisted, so the first command created in a fresh session took
 * `cmd1` — the id the FIRST saved command already had. Everything downstream keys on
 * id: the roster marked both rows selected, `find` returned the older one so the
 * detail panel showed the wrong command, and every `commandId` action
 * (`ASSIGN_UNIT`, `TOGGLE_REGION`, `SET_POSTURE`, `STAND_DOWN`) is a `.map` that hit
 * BOTH commands at once and then autosaved the result.
 *
 * Derived from state rather than a counter, so it is deterministic without a global.
 */
export function nextCommandId(existing: MilitaryCommand[]): string {
  const taken = new Set(existing.map((c) => c.id));
  let n = existing.reduce((max, c) => {
    const m = /^cmd(\d+)$/.exec(c.id);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  let id = `cmd${++n}`;
  // Ids that do not match `cmdN` (hand-authored, seeded) are not covered by the max
  // above, so confirm rather than assume.
  while (taken.has(id)) id = `cmd${++n}`;
  return id;
}

/**
 * Re-key any command whose id another command already used.
 *
 * Repairs org structures already saved with colliding ids, which is why the fix to
 * `nextCommandId` is not enough on its own — a player who created commands across two
 * sessions has the collision sitting in their saved data right now, and it renders as
 * two rows highlighting together and the wrong one opening.
 *
 * Keeps the FIRST holder of an id so the older command — the one with units and
 * history attached — is the one that stays put. Nothing outside this state references
 * a command id (`requireCommandingGeneral` resolves by `commandingGeneralId`), so
 * re-keying the newer duplicate is safe.
 */
export function dedupeCommandIds(commands: MilitaryCommand[]): MilitaryCommand[] {
  const seen = new Set<string>();
  let changed = false;
  const out = commands.map((c) => {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      return c;
    }
    changed = true;
    // Build against everything already settled plus everything still to come, so a
    // replacement id cannot collide with a later command's existing one.
    const id = nextCommandId([
      ...commands,
      ...[...seen].map((s) => ({ id: s }) as MilitaryCommand),
    ]);
    seen.add(id);
    return { ...c, id };
  });
  return changed ? out : commands;
}

/** Build a new command from a draft (mockup confirmCreate()). Units are assigned after creation. */
export function createCommand(
  draft: CommandDraft,
  existing: MilitaryCommand[]
): { command: MilitaryCommand } {
  const cap = 18 + draft.regionIds.length * 2;
  const baseEffectiveness = draftEffectiveness(draft);
  const command: MilitaryCommand = {
    id: nextCommandId(existing),
    name: draft.name.trim(),
    type: draft.type,
    commanderIds: [...draft.commanderIds],
    // Default the lead to the first chosen commander; the SecDef can change it after.
    commandingGeneralId:
      draft.commandingGeneralId && draft.commanderIds.includes(draft.commandingGeneralId)
        ? draft.commandingGeneralId
        : (draft.commanderIds[0] ?? null),
    regionIds: [...draft.regionIds],
    spec: COMMAND_TYPES[draft.type].label,
    posture: draft.posture,
    supply: draft.supply,
    readiness: "Forming",
    cap,
    base: baseEffectiveness,
    political: "Medium",
    branchFocus: "Combined",
    unitIds: [],
    role: `Newly established ${COMMAND_TYPES[draft.type].label.toLowerCase()} — awaiting force assignment.`,
  };
  return { command };
}
