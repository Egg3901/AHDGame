import type { CrisisEffect } from "@/lib/db/types/crisis";
import type {
  ConflictEvent,
  ConflictPhase,
  ConflictRole,
  FiredEvent,
  LivingConflictDef,
  LivingConflictState,
} from "./types";

/**
 * The pure heart of the living-conflict engine: state in, state out, no DB and
 * no clock. Every rule about how a conflict climbs, holds, ticks and emits lives
 * here so it can be tested as a plain state machine.
 */

export function emptyConflictState(defKey: string): LivingConflictState {
  return {
    defKey,
    hasOpened: false,
    phaseLevel: 0,
    intensity: 0,
    openedYear: null,
    pressure: {},
    phaseTurns: 0,
    totalTurns: 0,
    lastProcessedTurn: undefined,
    updatedAt: new Date(0),
  };
}

export function phaseFor(def: LivingConflictDef, level: number): ConflictPhase | null {
  return def.phases.find((p) => p.level === level) ?? null;
}

export function nextPhaseOf(def: LivingConflictDef, level: number): ConflictPhase | null {
  return def.phases.find((p) => p.level === level + 1) ?? null;
}

export function maxPhaseLevel(def: LivingConflictDef): number {
  return def.phases.reduce((m, p) => Math.max(m, p.level), 0);
}

function clampLevel(def: LivingConflictDef, level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(maxPhaseLevel(def), Math.round(level)));
}

function clamp01to100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

/** The governing pressure: the most-committed side bucket. */
export function governingPressure(state: LivingConflictState): number {
  const vals = Object.values(state.pressure);
  return vals.length ? Math.max(...vals) : 0;
}

/**
 * May the conflict enter its next phase right now? Gated by the next phase's
 * earliestYear (calendar) and minDwellTurns (time spent on the current phase).
 * `currentYear` undefined skips the year floor (pure callers, worlds with no
 * clock).
 */
export function canAdvance(
  def: LivingConflictDef,
  state: LivingConflictState,
  currentYear?: number
): boolean {
  const next = nextPhaseOf(def, state.phaseLevel);
  if (!next) return false;
  if (
    next.earliestYear !== undefined &&
    currentYear !== undefined &&
    currentYear < next.earliestYear
  ) {
    return false;
  }
  if (next.minDwellTurns !== undefined && state.phaseTurns < next.minDwellTurns) {
    return false;
  }
  return true;
}

/** Open the conflict at phase 1 in the given year. Idempotent on an open state. */
export function openConflict(
  state: LivingConflictState,
  openedYear: number | null
): LivingConflictState {
  if (state.hasOpened) return state;
  return {
    ...state,
    hasOpened: true,
    phaseLevel: 1,
    phaseTurns: 0,
    openedYear,
    updatedAt: new Date(),
  };
}

/**
 * Commit support to a side, climbing at most one phase when both the pressure
 * threshold and the phase gate allow. Blocked climbs hold pressure at the
 * threshold rather than ballooning, so the first commitment after the gate
 * opens climbs cleanly.
 */
export function applyCommitment(
  def: LivingConflictDef,
  state: LivingConflictState,
  side: string,
  amount: number,
  currentYear?: number
): LivingConflictState {
  const next: LivingConflictState = {
    ...state,
    pressure: { ...state.pressure },
    updatedAt: new Date(),
  };
  next.pressure[side] = clamp01to100((next.pressure[side] ?? 0) + amount);

  const phase = phaseFor(def, next.phaseLevel);
  if (!phase) return next;

  const pressure = governingPressure(next);
  const gateOpen = canAdvance(def, next, currentYear);

  if (pressure >= phase.advancePressure && gateOpen) {
    next.phaseLevel = clampLevel(def, next.phaseLevel + 1);
    next.phaseTurns = 0;
    for (const k of Object.keys(next.pressure)) {
      next.pressure[k] = Math.max(0, next.pressure[k] - phase.advancePressure);
    }
    next.intensity = clamp01to100(next.intensity + 12);
  } else if (pressure > phase.advancePressure && !gateOpen) {
    for (const k of Object.keys(next.pressure)) {
      next.pressure[k] = Math.min(next.pressure[k], phase.advancePressure);
    }
  }
  return next;
}

/** Drain a side's own pressure; only once it is spent does the phase come down. */
export function relieveCommitment(
  def: LivingConflictDef,
  state: LivingConflictState,
  side: string,
  amount: number
): LivingConflictState {
  const next: LivingConflictState = {
    ...state,
    pressure: { ...state.pressure },
    updatedAt: new Date(),
  };
  const drained = Math.max(0, (next.pressure[side] ?? 0) - amount);
  next.pressure[side] = drained;
  if (drained === 0 && next.phaseLevel > 0) {
    next.phaseLevel = clampLevel(def, next.phaseLevel - 1);
    next.phaseTurns = 0;
    next.intensity = clamp01to100(next.intensity - 8);
  }
  return next;
}

/** Advance the conflict's clocks by one turn. */
export function tickConflict(state: LivingConflictState): LivingConflictState {
  return {
    ...state,
    phaseTurns: state.phaseTurns + 1,
    totalTurns: state.totalTurns + 1,
    updatedAt: new Date(),
  };
}

export function adjustIntensity(state: LivingConflictState, delta: number): LivingConflictState {
  return { ...state, intensity: clamp01to100(state.intensity + delta), updatedAt: new Date() };
}

/** The passive per-turn effects a nation in the given role takes right now. */
export function passiveEffectsForRole(
  def: LivingConflictDef,
  level: number,
  role: ConflictRole
): CrisisEffect[] {
  return phaseFor(def, level)?.passiveEffects?.[role] ?? [];
}

/** The effects an event applies to a nation in the given role. */
export function eventEffectsForRole(event: ConflictEvent, role: ConflictRole): CrisisEffect[] {
  return event.effects?.[role] ?? [];
}

function triggerMatches(event: ConflictEvent, state: LivingConflictState): boolean {
  const t = event.trigger;
  if (!t) return event.kind === "authored"; // untriggered authored beats fire on phase entry
  if (t.onPhaseEnter && state.phaseTurns !== 0) return false;
  if (t.minIntensity !== undefined && state.intensity < t.minIntensity) return false;
  if (t.maxIntensity !== undefined && state.intensity > t.maxIntensity) return false;
  if (t.everyTurns !== undefined) {
    if (state.totalTurns <= 0 || state.totalTurns % t.everyTurns !== 0) return false;
  }
  return true;
}

/**
 * The events that fire this turn, deterministically. `turn` only stamps the
 * ids; selection reads live state (phaseTurns for phase-entry, totalTurns for
 * cadence, intensity for bands), never a clock or RNG, so a replayed turn emits
 * the identical set with identical ids.
 */
export function selectEvents(
  def: LivingConflictDef,
  state: LivingConflictState,
  turn: number
): FiredEvent[] {
  const phase = phaseFor(def, state.phaseLevel);
  if (!phase) return [];
  const fired: FiredEvent[] = [];
  for (const event of phase.events) {
    if (event.kind === "reactive") continue; // reactive events are pushed by responses
    if (!triggerMatches(event, state)) continue;
    fired.push({
      id: `${def.key}:${phase.key}:${turn}:${event.key}`,
      defKey: def.key,
      phaseKey: phase.key,
      turn,
      event,
    });
  }
  return fired;
}
