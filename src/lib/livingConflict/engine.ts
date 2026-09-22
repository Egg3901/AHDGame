import type { CrisisEffect } from "@/lib/db/types/crisis";
import type {
  ConflictEvent,
  ConflictPhase,
  ConflictRole,
  FiredEvent,
  LivingConflictDef,
  LivingConflictState,
  LivingConflictStatus,
} from "./types";
import { emptyCampaignState } from "./campaign";

/**
 * The pure heart of the living-conflict engine: state in, state out, no DB and
 * no clock. Every rule about how a conflict climbs, holds, ticks and emits lives
 * here so it can be tested as a plain state machine.
 */

export function emptyConflictState(defKey: string): LivingConflictState {
  return {
    defKey,
    hasOpened: false,
    status: "dormant",
    phaseLevel: 0,
    intensity: 0,
    openedYear: null,
    pressure: {},
    tracks: {},
    phaseTurns: 0,
    totalTurns: 0,
    lastProcessedTurn: undefined,
    campaign: emptyCampaignState(),
    updatedAt: new Date(0),
  };
}

/** Resolve authored participants against the countries that exist in this world. */
export function resolveConflictParticipants(
  def: LivingConflictDef,
  availableCountryIds: ReadonlySet<string>
): LivingConflictDef["participants"] {
  const resolveOne = (countryId: string | undefined): string | undefined => {
    if (!countryId) return undefined;
    if (availableCountryIds.has(countryId)) return countryId;
    return (def.participantFallbacks?.[countryId] ?? []).find((candidate) =>
      availableCountryIds.has(candidate)
    );
  };
  const resolveMany = (countryIds: string[]): string[] => [
    ...new Set(countryIds.map(resolveOne).filter((value): value is string => Boolean(value))),
  ];

  return {
    belligerents: resolveMany(def.participants.belligerents),
    ...(resolveOne(def.participants.backerA)
      ? { backerA: resolveOne(def.participants.backerA) }
      : {}),
    ...(resolveOne(def.participants.backerB)
      ? { backerB: resolveOne(def.participants.backerB) }
      : {}),
    neighbors: resolveMany(def.participants.neighbors),
    blocMembers: resolveMany(def.participants.blocMembers),
    bystanders: resolveMany(def.participants.bystanders),
  };
}

function trackBounds(def: LivingConflictDef, key: string): { min: number; max: number } {
  const authored = def.tracks?.[key];
  return { min: authored?.min ?? 0, max: authored?.max ?? 100 };
}

function clampTrack(def: LivingConflictDef, key: string, value: number): number {
  const { min, max } = trackBounds(def, key);
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Upgrade an old stored row at the read boundary. This is intentionally pure:
 * callers may persist the normalized row on their next ordinary write, while
 * old worlds remain readable without a destructive migration.
 */
export function normalizeConflictState(
  def: LivingConflictDef,
  input: Partial<LivingConflictState> & Pick<LivingConflictState, "defKey">
): LivingConflictState {
  const base = emptyConflictState(input.defKey);
  const authoredTracks = Object.fromEntries(
    Object.entries(def.tracks ?? {}).map(([key, track]) => [
      key,
      clampTrack(def, key, input.tracks?.[key] ?? track.initial),
    ])
  );
  const extraTracks = Object.fromEntries(
    Object.entries(input.tracks ?? {})
      .filter(([key]) => !(key in authoredTracks))
      .map(([key, value]) => [key, clampTrack(def, key, value)])
  );
  const hasOpened = input.hasOpened ?? base.hasOpened;

  return {
    ...base,
    ...input,
    hasOpened,
    status: input.status ?? (hasOpened ? "active" : "dormant"),
    pressure: { ...base.pressure, ...(input.pressure ?? {}) },
    tracks: { ...authoredTracks, ...extraTracks },
    campaign: input.campaign ?? base.campaign,
    updatedAt: input.updatedAt ?? base.updatedAt,
  };
}

/** Apply several progress changes atomically and clamp every authored track. */
export function applyTrackDeltas(
  def: LivingConflictDef,
  state: LivingConflictState,
  deltas: Record<string, number>
): LivingConflictState {
  const tracks = { ...(state.tracks ?? {}) };
  for (const [key, delta] of Object.entries(deltas)) {
    tracks[key] = clampTrack(def, key, (tracks[key] ?? def.tracks?.[key]?.initial ?? 0) + delta);
  }
  return { ...state, tracks, updatedAt: new Date() };
}

export interface ConflictOutcomeDelta {
  trackDeltas?: Record<string, number>;
  nextConflictPhase?: string;
  nextConflictStatus?: LivingConflictStatus;
}

/** Apply the persistent trajectory authored on a resolved response outcome. */
export function applyConflictOutcome(
  def: LivingConflictDef,
  state: LivingConflictState,
  outcome: ConflictOutcomeDelta
): LivingConflictState {
  let next = normalizeConflictState(def, state);
  if (outcome.trackDeltas && Object.keys(outcome.trackDeltas).length > 0) {
    next = applyTrackDeltas(def, next, outcome.trackDeltas);
  }
  if (outcome.nextConflictPhase) {
    const phase = def.phases.find((candidate) => candidate.key === outcome.nextConflictPhase);
    if (phase) next = { ...next, phaseLevel: phase.level, phaseTurns: 0 };
  }
  if (outcome.nextConflictStatus) {
    next = { ...next, status: outcome.nextConflictStatus };
  }
  return { ...next, updatedAt: new Date() };
}

export interface ConflictTransitionResult {
  state: LivingConflictState;
  appliedTransitionKey: string | null;
}

/** Combine every deterministic background pressure active on this turn. */
export function scheduledPressureDeltas(
  def: LivingConflictDef,
  state: LivingConflictState,
  currentYear?: number
): Record<string, number> {
  const phase = phaseFor(def, state.phaseLevel);
  if (!phase) return {};
  const deltas: Record<string, number> = {};

  for (const pressure of def.scheduledPressures ?? []) {
    if (pressure.phaseKeys && !pressure.phaseKeys.includes(phase.key)) continue;
    if (
      currentYear === undefined &&
      (pressure.fromYear !== undefined || pressure.untilYear !== undefined)
    ) {
      continue;
    }
    if (
      currentYear !== undefined &&
      pressure.fromYear !== undefined &&
      currentYear < pressure.fromYear
    ) {
      continue;
    }
    if (
      currentYear !== undefined &&
      pressure.untilYear !== undefined &&
      currentYear > pressure.untilYear
    ) {
      continue;
    }
    if (
      pressure.everyTurns !== undefined &&
      (state.totalTurns <= 0 || state.totalTurns % pressure.everyTurns !== 0)
    ) {
      continue;
    }
    for (const [key, delta] of Object.entries(pressure.trackDeltas)) {
      deltas[key] = (deltas[key] ?? 0) + delta;
    }
  }
  return deltas;
}

/** Evaluate at most one highest-priority authored transition. */
export function evaluateConflictTransitions(
  def: LivingConflictDef,
  state: LivingConflictState,
  currentYear?: number
): ConflictTransitionResult {
  const phase = phaseFor(def, state.phaseLevel);
  if (!phase) return { state, appliedTransitionKey: null };

  const candidates = (def.transitions ?? [])
    .map((transition, order) => ({ transition, order }))
    .filter(({ transition }) => transition.fromPhase === phase.key)
    .filter(({ transition }) => !transition.fromStatus || transition.fromStatus === state.status)
    .filter(
      ({ transition }) =>
        currentYear === undefined ||
        ((transition.earliestYear === undefined || currentYear >= transition.earliestYear) &&
          (transition.latestYear === undefined || currentYear <= transition.latestYear))
    )
    .filter(({ transition }) =>
      transition.conditions.every((condition) => {
        const value = state.tracks?.[condition.track] ?? 0;
        return (
          (condition.min === undefined || value >= condition.min) &&
          (condition.max === undefined || value <= condition.max)
        );
      })
    )
    .sort(
      (a, b) => (b.transition.priority ?? 0) - (a.transition.priority ?? 0) || a.order - b.order
    );

  const selected = candidates[0]?.transition;
  if (!selected) return { state, appliedTransitionKey: null };
  const target = def.phases.find((candidate) => candidate.key === selected.toPhase);
  if (!target) return { state, appliedTransitionKey: null };

  return {
    state: {
      ...state,
      phaseLevel: target.level,
      phaseTurns: 0,
      status: selected.toStatus ?? state.status ?? (state.hasOpened ? "active" : "dormant"),
      updatedAt: new Date(),
    },
    appliedTransitionKey: selected.key,
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
    status: "active" as LivingConflictStatus,
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
  if (t.campaignStages && !t.campaignStages.includes(state.campaign?.stage ?? "posture")) {
    return false;
  }
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
