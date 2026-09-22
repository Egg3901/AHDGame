/**
 * UK government confidence gauge (epic #856, ticket #858 — Cluster B).
 *
 * A running government-stability value in [0, 100]. Dissolution / a general
 * election is triggered only when it BOTTOMS OUT (reaches 0), not on any single
 * lost vote — see ops-knowledge `uk-rework-design-2026-08-25`.
 *
 * This module is pure gauge arithmetic, decoupled from the existing
 * no-confidence command flow; integration (persisting the value, firing
 * dissolution) is wired separately. All magnitudes are first-pass and are the
 * primary thing to calibrate in worldsim before the gauge drives live outcomes.
 */

export const CONFIDENCE_MIN = 0;
export const CONFIDENCE_MAX = 100;
export const CONFIDENCE_START = 100;

/** One-off downward shocks. */
export const CONFIDENCE_HITS = {
  /** Failing the annual Budget — the single biggest input, near-automatic crisis. */
  budgetDefeat: 60,
  /** Losing a formal vote of no confidence (does not itself dissolve; dents the gauge). */
  lostVonc: 40,
  /** Losing another flagged key vote. */
  lostKeyVote: 15,
  /** PM firing an individual minister — moderate; recovers over time if approval is high. */
  ministerFired: 8,
  /** A minister resigning of their own accord — flat; waves sum to destabilise. */
  ministerResigned: 12,
} as const;

export const CONFIDENCE_GAINS = {
  /** Passing the government's central annual programme restores authority. */
  budgetPass: 10,
} as const;

/** Great Offices of State (Chancellor, Foreign, Home) hit harder on departure. */
export const GREAT_OFFICE_MULTIPLIER = 2;

/** UK cabinet position ids that count as Great Offices of State. */
export const GREAT_OFFICE_POSITION_IDS = new Set([
  "chancellor",
  "foreign_secretary",
  "home_secretary",
]);

export type ConfidenceEvent =
  | { kind: "budgetPass" }
  | { kind: "budgetDefeat" }
  | { kind: "lostVonc" }
  | { kind: "lostKeyVote" }
  | { kind: "ministerFired"; greatOffice?: boolean }
  | { kind: "ministerResigned"; greatOffice?: boolean };

function clamp(v: number): number {
  return Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX, v));
}

/** Apply a one-off confidence event, returning the new clamped gauge value. */
export function applyConfidenceEvent(gauge: number, event: ConfidenceEvent): number {
  let hit: number;
  switch (event.kind) {
    case "budgetPass":
      hit = -CONFIDENCE_GAINS.budgetPass;
      break;
    case "budgetDefeat":
      hit = CONFIDENCE_HITS.budgetDefeat;
      break;
    case "lostVonc":
      hit = CONFIDENCE_HITS.lostVonc;
      break;
    case "lostKeyVote":
      hit = CONFIDENCE_HITS.lostKeyVote;
      break;
    case "ministerFired":
      hit = CONFIDENCE_HITS.ministerFired * (event.greatOffice ? GREAT_OFFICE_MULTIPLIER : 1);
      break;
    case "ministerResigned":
      hit = CONFIDENCE_HITS.ministerResigned * (event.greatOffice ? GREAT_OFFICE_MULTIPLIER : 1);
      break;
  }
  return clamp(gauge - hit);
}

/** Approval at/above which the gauge recovers; below which it erodes on its own. */
export const CONFIDENCE_APPROVAL_PIVOT = 50;
/** Max recovery per turn (at 100 approval). */
export const CONFIDENCE_MAX_RECOVERY_PER_TURN = 5;
/** Max self-erosion per turn (at 0 approval). */
export const CONFIDENCE_MAX_EROSION_PER_TURN = 2;
/** Broken-promise bleed at a fully-broken manifesto (meter 0), per turn. */
export const CONFIDENCE_BROKEN_PROMISE_BLEED = 3;

/**
 * Per-turn drift from standing conditions (no discrete event):
 *  - approval above the pivot recovers the gauge (a popular govt heals; this is
 *    what lets a fired-minister hit fade when the PM is popular), below it erodes.
 *  - the broken-promise meter (kept/total, 0..1) bleeds the gauge continuously —
 *    the explicit Cluster A → Cluster B coupling.
 */
export function tickConfidence(
  gauge: number,
  opts: { approval: number; brokenPromiseMeter?: number }
): number {
  const a = Math.max(0, Math.min(100, opts.approval));
  let drift: number;
  if (a >= CONFIDENCE_APPROVAL_PIVOT) {
    drift =
      ((a - CONFIDENCE_APPROVAL_PIVOT) / (100 - CONFIDENCE_APPROVAL_PIVOT)) *
      CONFIDENCE_MAX_RECOVERY_PER_TURN;
  } else {
    drift =
      -((CONFIDENCE_APPROVAL_PIVOT - a) / CONFIDENCE_APPROVAL_PIVOT) *
      CONFIDENCE_MAX_EROSION_PER_TURN;
  }
  const meter = opts.brokenPromiseMeter;
  if (typeof meter === "number") {
    const brokenFraction = Math.max(0, Math.min(1, 1 - meter));
    drift -= brokenFraction * CONFIDENCE_BROKEN_PROMISE_BLEED;
  }
  return clamp(gauge + drift);
}

/** Dissolution / general election fires only when the gauge bottoms out. */
export function isDissolutionTriggered(gauge: number): boolean {
  return gauge <= CONFIDENCE_MIN;
}
