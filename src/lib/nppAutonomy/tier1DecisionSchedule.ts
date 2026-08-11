/**
 * Tier-1 NPP strategic decision schedule (#3724).
 *
 * Economic accounting (sectors, budgets, contracts, markets) continues every
 * normal turn and is intentionally outside this module. Strategic decisions —
 * policy, appointment, sector-order, diplomacy, and sphere — share one
 * deterministic six-hour (= six-turn) bucket cadence so autonomous countries do
 * not all decide on the same turn.
 *
 * Scheduling uses only stable country identity and turn/cycle math — never
 * wall-clock randomness. Callers persist `lastCompletedCycle` and claim the
 * slot before acting so a missed/restarted worker recovers without double-firing.
 */

/** One turn = one real hour; six buckets ⇒ six-hour decision cadence. */
export const TIER1_NPP_DECISION_BUCKET_COUNT = 6;

/** Sector/budget/contract/market accounting cadence — every normal turn. */
export const TIER1_ECONOMIC_ACCOUNTING_CADENCE_TURNS = 1;

/**
 * Strategic decision surfaces gated by this schedule. Diplomacy/sphere callers
 * that land later should reuse {@link evaluateTier1NppDecisionSchedule} rather
 * than inventing a second cadence.
 */
export const TIER1_STRATEGIC_DECISION_KINDS = [
  "policy",
  "appointment",
  "sector-order",
  "diplomacy",
  "sphere",
] as const;

export type Tier1StrategicDecisionKind = (typeof TIER1_STRATEGIC_DECISION_KINDS)[number];

export type Tier1DecisionSkipReason = "not-due" | "already-completed" | "player-controlled";

export interface Tier1DecisionScheduleInput {
  /** Stable country identity (CountryId / entity id). */
  countryId: string;
  /** Current game turn (1-indexed). */
  turn: number;
  /**
   * Last decision cycle for which strategic actions were successfully claimed.
   * `null`/`undefined` means never claimed.
   */
  lastCompletedCycle: number | null | undefined;
  /**
   * True when a human controls the decision surface — NPP must not also act.
   */
  playerControlled: boolean;
}

export interface Tier1DecisionScheduleVerdict {
  run: boolean;
  bucket: number;
  cycle: number;
  reason?: Tier1DecisionSkipReason;
  /**
   * Persist this as `lastCompletedCycle` after a successful claim (before or
   * immediately after acting — claim-before-act is preferred for restart safety).
   */
  completedCycle?: number;
}

/** Salt keeps short ISO codes from clustering into the same FNV bucket. */
const BUCKET_HASH_SALT = "npp-tier1-decision:";

/**
 * Deterministic FNV-1a bucket in `[0, TIER1_NPP_DECISION_BUCKET_COUNT)`.
 * Same country id always maps to the same bucket across restarts.
 */
export function tier1DecisionBucket(countryId: string): number {
  const s = BUCKET_HASH_SALT + countryId;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % TIER1_NPP_DECISION_BUCKET_COUNT;
}

/**
 * Decision cycle index for a turn. Turns 1–6 are cycle 0, 7–12 cycle 1, …
 * Uses 1-indexed turns so the first wall-clock hour of a world is cycle 0.
 */
export function tier1DecisionCycle(turn: number): number {
  if (turn < 1) return 0;
  return Math.floor((turn - 1) / TIER1_NPP_DECISION_BUCKET_COUNT);
}

/** True when this country is scheduled to decide on `turn`. */
export function isTier1DecisionTurn(countryId: string, turn: number): boolean {
  if (turn < 1) return false;
  const offset = (turn - 1) % TIER1_NPP_DECISION_BUCKET_COUNT;
  return offset === tier1DecisionBucket(countryId);
}

/**
 * First turn of `cycle` on which `countryId` is due
 * (`turn = cycle * 6 + bucket + 1`).
 */
export function tier1DecisionTurnForCycle(countryId: string, cycle: number): number {
  const safeCycle = Math.max(0, Math.floor(cycle));
  return safeCycle * TIER1_NPP_DECISION_BUCKET_COUNT + tier1DecisionBucket(countryId) + 1;
}

/** Economic accounting is due every normal turn — never bucket-gated. */
export function isTier1EconomicAccountingTurn(_turn: number): boolean {
  return true;
}

/**
 * Pure eligibility check for Tier-1 NPP strategic decisions.
 *
 * Missed-window semantics: if a worker was down for a country's due turn, the
 * next due turn in a later cycle still fires once (`lastCompletedCycle < cycle`).
 * Replaying the same cycle is refused (`already-completed`) so a restarted
 * worker cannot double-fire.
 */
export function evaluateTier1NppDecisionSchedule(
  input: Tier1DecisionScheduleInput
): Tier1DecisionScheduleVerdict {
  const bucket = tier1DecisionBucket(input.countryId);
  const cycle = tier1DecisionCycle(input.turn);

  if (input.playerControlled) {
    return { run: false, bucket, cycle, reason: "player-controlled" };
  }

  if (!isTier1DecisionTurn(input.countryId, input.turn)) {
    return { run: false, bucket, cycle, reason: "not-due" };
  }

  const last = input.lastCompletedCycle;
  if (last != null && last >= cycle) {
    return { run: false, bucket, cycle, reason: "already-completed" };
  }

  return { run: true, bucket, cycle, completedCycle: cycle };
}

/**
 * Simulate a worker that processes only the turns in `processedTurns` and
 * claims each due slot. Used by equivalence tests for missed/restarted workers.
 *
 * Returns the ordered list of cycles that were claimed (never duplicates).
 */
export function replayTier1DecisionClaims(input: {
  countryId: string;
  processedTurns: readonly number[];
  playerControlled?: boolean;
  initialLastCompletedCycle?: number | null;
}): { claimedCycles: number[]; finalLastCompletedCycle: number | null } {
  let last = input.initialLastCompletedCycle ?? null;
  const claimedCycles: number[] = [];

  for (const turn of input.processedTurns) {
    const verdict = evaluateTier1NppDecisionSchedule({
      countryId: input.countryId,
      turn,
      lastCompletedCycle: last,
      playerControlled: input.playerControlled === true,
    });
    if (verdict.run && verdict.completedCycle != null) {
      claimedCycles.push(verdict.completedCycle);
      last = verdict.completedCycle;
    }
  }

  return { claimedCycles, finalLastCompletedCycle: last };
}
