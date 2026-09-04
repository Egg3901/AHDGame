import type {
  CommandType,
  CommandPosture,
  SupplyPriority,
  MilitaryCommand,
  MilitaryOperation,
  MilitaryState,
} from "./types";
import { COMMAND_TYPES } from "./config";
import { getRegion } from "./regions";
import { commandsOfRegion, draftEffectiveness } from "./calc";

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

/**
 * The advice a command spanning more than one macro theatre draws.
 *
 * Exported so the create dialog and the detail panel word it identically: the same
 * structure should not read as two different pieces of guidance depending on where the
 * Secretary happens to be standing.
 */
export const LOGISTICS_PAIRING_ADVICE =
  "Logistics command recommended for multi-theatre overseas sustainment.";

/**
 * Whether a command should be advised to pair with a Logistics command.
 *
 * Sustainment strain comes from the spread across macro theatres, not from the number of
 * regions. This condition used to be `regionIds.length >= REGION_CAP`, and REGION_CAP is a
 * hard cap the create dialog and the reducer both enforce, so it was satisfiable at
 * exactly the cap and nowhere else: every filled non-Logistics command drew the advice and
 * no partial one could. Ticket 1244 met that as South Asia + East Asia + Southeast Asia
 * drawing it while any two of the three drew nothing, though all three are one theatre.
 * Regions sharing a theatre share the tail that supplies them; two theatres are two tails.
 *
 * Takes the regions rather than a draft because a saved MilitaryCommand needs the same
 * answer as a CommandDraft, and the two shapes have nothing else in common. An id the map
 * does not know contributes no theatre rather than counting as one of its own, so a
 * command naming a retired region is not advised about a spread it does not have.
 *
 * A Logistics command IS the sustainment structure, so it is never told to go find one.
 */
export function needsLogisticsPairing(type: CommandType, regionIds: string[]): boolean {
  if (type === "LOGISTICS") return false;
  const theatres = new Set(
    regionIds.map((rid) => getRegion(rid)?.macro).filter((macro): macro is string => Boolean(macro))
  );
  return theatres.size > 1;
}

// Ported from the mockup's draftWarnings().
export function validateDraft(draft: CommandDraft, state: MilitaryState): string[] {
  const w: string[] = [];
  for (const rid of draft.regionIds) {
    // Only a same-type owner is a role conflict — the line `overlappingRegions` has
    // always drawn. Warning on every owner told players that pairing a Logistics
    // command with the Regional command already holding a region was a mistake, when
    // it is the recommended way to sustain a fight overseas.
    const owners = commandsOfRegion(state, rid).filter((c) => c.type === draft.type);
    if (owners.length)
      w.push(
        `${getRegion(rid)?.name} is already assigned to ${owners[0].name}, a command of the same type.`
      );
  }
  if (!draft.commanderIds.length) {
    w.push("No commander selected: command efficiency will be reduced by 10%.");
  }
  if (draft.regionIds.length > 4) {
    w.push("Assigned regions exceed the recommended region load (4).");
  }
  const overseasNaval = draft.regionIds.some((rid) => getRegion(rid)?.type === "naval");
  const navalCapable = draft.type === "LOGISTICS";
  if (overseasNaval && !navalCapable) {
    w.push("No naval command structure for an assigned sea region: coverage will be weak.");
  }
  if (needsLogisticsPairing(draft.type, draft.regionIds)) {
    w.push(LOGISTICS_PAIRING_ADVICE);
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
    role: `Newly established ${COMMAND_TYPES[draft.type].label.toLowerCase()}, awaiting force assignment.`,
  };
  return { command };
}

/**
 * Drop commanders who are no longer commissioned generals of this country.
 *
 * A commander id is a character id, and a character can leave: emigrate to another
 * country, or be dismissed as a general. Neither event touches the saved command,
 * so the id stays in `commanderIds` pointing at somebody this country's roster no
 * longer contains. Live data has exactly this — Russia's only command listed a
 * general who had moved to the United Kingdom.
 *
 * The result was a command nobody could edit again. The detail panel renders a
 * commander by looking them up in the roster and skipping a miss, so the row was
 * invisible while the header still counted it ("COMMANDERS · 1" above an empty
 * list) — there was no ✕ to click. Meanwhile the commands PUT re-checks every
 * commanderId against that same roster and 400s the whole array, so every later
 * edit (a region, a unit, a new command entirely) was refused because of a name
 * the Secretary could not see and had never chosen.
 *
 * So the state that LOADS has to be a state that can be SAVED, the same rule
 * `dedupeCommandIds` and the `commandingGeneralId` back-compat already keep. The
 * route also requires the lead to be one of the command's own commanders, so a
 * lead is cleared whenever they are not on the kept list — whether they were the
 * one who left, or a stored orphan from before the reducer learned to clear the
 * lead alongside the commander it removes.
 *
 * Returns the input array unchanged when nothing was stale, so a reducer seeded
 * from it does not see a new identity on every render.
 */
export function reconcileCommandCommanders(
  commands: MilitaryCommand[],
  validCommanderIds: Iterable<string>
): { commands: MilitaryCommand[]; removed: number } {
  const roster = new Set(validCommanderIds);
  let removed = 0;
  let changed = false;
  const out = commands.map((c) => {
    const kept = c.commanderIds.filter((id) => roster.has(id));
    const lead =
      c.commandingGeneralId && kept.includes(c.commandingGeneralId) ? c.commandingGeneralId : null;
    if (kept.length === c.commanderIds.length && lead === c.commandingGeneralId) return c;
    removed += c.commanderIds.length - kept.length;
    changed = true;
    return { ...c, commanderIds: kept, commandingGeneralId: lead };
  });
  return changed ? { commands: out, removed } : { commands, removed: 0 };
}
