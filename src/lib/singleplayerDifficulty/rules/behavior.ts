import type { SingleplayerDifficulty } from "@/lib/db/types";

/**
 * DIFFICULTY BEHAVIOR POLICY
 *
 * Two orthogonal axes govern autonomous politicians, and conflating them is the
 * failure this module exists to prevent:
 *
 *   - **Autonomy** (`NppAutonomyLevel`) says WHICH activities an NPP may perform.
 *     It is a world-wide capability tier and is identical for every player.
 *   - **Difficulty** (`SingleplayerDifficulty`, local worlds only) says HOW
 *     COMPETENTLY they perform the activities autonomy already permits. It never
 *     unlocks an activity, never removes one, and never relaxes a law, cost,
 *     cooldown, visibility rule, or authority check.
 *
 * The sibling `rules/index.ts` tunes NPP *resources* (action points, caps, donor
 * multiplier). That is a resource bonus and is disclosed to the player as one.
 * This file tunes *decisions* only, so the two can never be confused in review:
 * nothing here hands an NPP a single extra action point or unit of currency.
 *
 * Every field below is consumed by a named mechanism with its own test. A field
 * nothing reads is a lie about the difficulty setting, so there are none.
 *
 * `normal` is defined as the shipped v4 behavior for every lever that has a
 * pre-V5 equivalent (`candidateLimit: null`, `minBillScore: 0`,
 * `reserveActionMult: 0`, `oppositionCoordination: 1`). That is deliberate: it
 * makes "V4 Normal vs V5 Normal" isolate the V5 increment, and "V5 Easy vs V5
 * Hard" isolate difficulty, instead of confounding the two. The goal fields have
 * no pre-V5 equivalent, so `normal` there is simply the intended V5 baseline.
 */

/** Hard ceiling on concurrently tracked governing goals, at any difficulty. */
export const GOAL_SLOT_CAP = 5;

export interface NppBehaviorPolicy {
  /**
   * How many governing goals (V5) a government tracks at once. More slots means
   * the government keeps pursuing secondary domains instead of dropping them the
   * moment something louder appears. Clamped to {@link GOAL_SLOT_CAP}.
   * Consumed by `reconcileGoverningGoals`.
   */
  goalSlots: number;
  /**
   * How long a committed goal is held before a better-ranked domain may take its
   * slot. The anti-oscillation window: a short hold produces a government that
   * re-decides every cycle, a long one produces follow-through. Consumed by
   * `reconcileGoverningGoals`.
   */
  goalHoldTurns: number;
  /**
   * Shortfall in [0,1] against a minister's agenda-relevant targets that breaks a
   * standing ministerial commitment before its hold expires. Lower = the
   * government notices a failing portfolio sooner. Consumed by
   * `planMinisterialActions` via `ministerialCommitmentHolds`.
   */
  replanShortfallThreshold: number;
  /**
   * How many legislation candidates a sponsor evaluates before choosing.
   * `null` evaluates every candidate (the shipped behavior). A finite limit is a
   * genuinely worse *decision*, not a smaller entitlement: the sponsor still may
   * file exactly as often, it just considers a narrower slate and therefore more
   * often files a mediocre bill. Consumed by `selectNppBill`.
   */
  candidateLimit: number | null;
  /**
   * Minimum combined selection score below which a sponsor declines to file at
   * all and keeps its slot for a better opportunity. `0` files whatever scores
   * best, however weakly (the shipped behavior). Consumed by `selectNppBill`.
   */
  minBillScore: number;
  /**
   * Funds an NPP keeps back, as a multiple of the cheapest action's cost, before
   * spending on a discretionary action. `0` spends down to zero (the shipped
   * behavior); `1` keeps one action in hand so the NPP can still respond to a
   * moment worth responding to. This is spending DISCIPLINE, not income: it can
   * only ever cause an NPP to spend less than it otherwise would. Consumed by
   * `decideNppAction`.
   */
  reserveActionMult: number;
  /**
   * Multiplier on the opposition's bloc-vote bias. `1` is the shipped
   * `OPPOSITION_BIAS_BASE`. Above 1 the opposition holds together better against
   * government bills; below 1 it is easier to peel apart. Bounded by
   * `computeOppositionVoteForce`'s own clamp on the resulting force. Consumed by
   * `computeOppositionVoteForce`.
   */
  oppositionCoordination: number;
}

const POLICIES: Record<SingleplayerDifficulty, NppBehaviorPolicy> = {
  easy: {
    goalSlots: 2,
    goalHoldTurns: 168,
    replanShortfallThreshold: 0.6,
    candidateLimit: 6,
    minBillScore: 0,
    reserveActionMult: 0,
    oppositionCoordination: 0.6,
  },
  normal: {
    goalSlots: 3,
    goalHoldTurns: 336,
    replanShortfallThreshold: 0.45,
    candidateLimit: null,
    minBillScore: 0,
    reserveActionMult: 0,
    oppositionCoordination: 1,
  },
  hard: {
    goalSlots: GOAL_SLOT_CAP,
    goalHoldTurns: 504,
    replanShortfallThreshold: 0.3,
    candidateLimit: null,
    minBillScore: 0.3,
    reserveActionMult: 1,
    oppositionCoordination: 1.35,
  },
};

/**
 * The behavior policy for a difficulty. Undefined (every hosted/multiplayer
 * world, and any local world written before difficulty existed) resolves to
 * `normal`, which is the shipped behavior — so this module can be wired into a
 * shared code path without changing multiplayer at all.
 */
export function nppBehaviorPolicy(
  difficulty: SingleplayerDifficulty | undefined
): NppBehaviorPolicy {
  const policy = POLICIES[difficulty ?? "normal"];
  return { ...policy, goalSlots: Math.max(1, Math.min(GOAL_SLOT_CAP, policy.goalSlots)) };
}

/** The `normal` policy, for callers with no world context (tests, pure helpers). */
export const DEFAULT_NPP_BEHAVIOR_POLICY: NppBehaviorPolicy = nppBehaviorPolicy("normal");

/**
 * Deterministically narrow a candidate slate to `limit` entries.
 *
 * Truncating the caller's array order would pin an Easy world to whatever the
 * database happened to return first, forever — the same handful of legislation
 * types every cycle. Instead each candidate gets a stable hash of its own key
 * plus a per-decision `salt` (country + party + turn), and the lowest hashes
 * win. Same salt, same slate; next cycle, a different one. Pure, no rng, no
 * clock — the salt carries the turn in from the caller.
 */
export function narrowCandidateSlate<T>(
  candidates: readonly T[],
  keyOf: (candidate: T) => string,
  limit: number | null,
  salt: string
): readonly T[] {
  if (limit === null || limit <= 0 || candidates.length <= limit) return candidates;
  const scored = candidates.map((candidate, index) => ({
    candidate,
    index,
    hash: hashKey(`${salt}|${keyOf(candidate)}`),
  }));
  scored.sort((a, b) => (a.hash !== b.hash ? a.hash - b.hash : a.index - b.index));
  return scored.slice(0, limit).map((entry) => entry.candidate);
}

/** FNV-1a. Small, stable across processes, and adequate for slate selection. */
function hashKey(text: string): number {
  let state = 2_166_136_261;
  for (let index = 0; index < text.length; index++) {
    state ^= text.charCodeAt(index);
    state = Math.imul(state, 16_777_619);
  }
  return state >>> 0;
}
