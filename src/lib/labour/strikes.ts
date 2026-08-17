/**
 * Phase 6, Strikes (`labourSystemMode >= "unions"`, same tier as Phase 5).
 *
 * Two independent mechanisms, both gated on the same tier:
 *  1. `unionPremium` (unionization.ts), a standing labor-cost surcharge,
 *     always live once unionization > 0. No event, no state machine.
 *  2. Strikes (this file), a per-sector bounded-duration event: triggers
 *     when unionization is high AND real wages lag a slow-moving "worker
 *     expectation index" by more than a threshold; throttles revenue +
 *     margin while active; resolves via concession (CEO raises wageLevel,
 *     gap closes) or wait-it-out (duration expires, unionization bumps up).
 *     Union-busting (a third resolution path) is Phase 7, not built here.
 *
 * Degeneracy guard (no always-strike/never-strike equilibrium), per
 * docs/plans/2026-06-30-labour-system.md Phase 6:
 *  - The trigger gap threshold is strictly above the concession gap
 *    threshold (hysteresis), closing the gap partway doesn't immediately
 *    re-trigger a strike that just ended.
 *  - The worker expectation index moves at most WORKER_EXPECTATION_TREND_STEP
 *    per turn, far slower than wageLevel can move (an instant CEO slider
 *    change), so the gap can't be gamed by rapid wage oscillation.
 *  - A cooldown follows EVERY resolution (concession or waitout), not just
 *    one path, see `stepStrike`.
 *
 * STRIKE_UNIONIZATION_THRESHOLD is calibrated against the real ceiling of
 * `unionizationDriftTarget()` (unionization.ts), not picked in isolation.
 *
 * **Updated for v3 Phase 7b/8 (code-review fix, 2026-07-01):** the original
 * Phase 6 comment claimed a ~63 ceiling under "wage/unemployment/min-wage"
 * stress alone and said 55 "requires 2+ stress factors." That's now
 * incomplete, not wrong, Phase 7b (union-law bias, ±30pp) and Phase 8
 * (union membership pressure, +30pp) added two MORE additive terms to the
 * same target, raising the real ceiling to ~100 (clamped). The "2+ factors"
 * invariant still holds in the sense that matters: NO single factor alone
 *, wage (~24), unemployment (~9), min-wage (~10), union-law (~30), or
 * membership pressure (~30), crosses 55 by itself. What changed is that
 * the set of qualifying "stress factors" now includes two political/
 * organizational levers that require ZERO real wage or employment stress:
 * a country with a maximal pro-labor union law AND an actively-recruiting
 * union can cross 55 (20 baseline + 30 + 30 = 80) with every economic
 * input sitting at neutral. This is treated as INTENDED, not a bug, Phase
 * 7b/8 exist specifically to give political organizing real teeth
 * independent of provable economic distress (the "labour is political"
 * design thesis), not to be strictly subordinate to it. See
 * `unionization.test.ts`'s composed-ceiling test, which pins this
 * combination as an executable invariant instead of relying on this prose.
 */

/**
 * v3 Phase 7b: weight applied to a country's union-law bias (-50..+50) when
 * computing the country-adjusted `unionizationThreshold` override passed
 * into `stepStrike`, positive (collective-bargaining) bias LOWERS the
 * threshold (easier to trigger), negative (right-to-work) RAISES it. Max
 * shift ±10 (bias 50 × 0.2). Deliberately does NOT bias
 * `expectationGapThreshold`: that would narrow the hysteresis gap between
 * the trigger and concession thresholds (currently a verified, tested
 * invariant: see the regression test in strikes.test.ts), risking the
 * flip-flop degeneracy the whole hysteresis design exists to prevent. The
 * unionization-level channel already has real headroom to work with, since
 * `unionizationDriftTarget()`'s own law term also raises the achievable
 * ceiling: that's enough teeth for the government's lever without
 * destabilizing the trigger/concession gap.
 */
export const STRIKE_LAW_THRESHOLD_WEIGHT = 0.2;

/** Unionization must exceed this for a strike to trigger. See file docblock for the ~63 ceiling this is calibrated against. */
export const STRIKE_UNIONIZATION_THRESHOLD = 55;

/** Worker-expectation-vs-real-wage gap (see `realWageIndex`) that must be exceeded to TRIGGER a strike. */
export const STRIKE_EXPECTATION_GAP_THRESHOLD = 0.12;

/** Gap an ACTIVE strike must close to for concession to resolve it, strictly below the trigger threshold (the hysteresis gap). */
export const STRIKE_CONCESSION_GAP_THRESHOLD = 0.04;

/** Per-turn step limit on the worker expectation index's drift toward the current real wage. */
export const WORKER_EXPECTATION_TREND_STEP = 0.02;

/** Defensive bounds on the worker expectation index, it tracks a moving target, not a fixed accumulator, but is clamped like every other labour index in this system. */
const WORKER_EXPECTATION_MIN = 0.3;
const WORKER_EXPECTATION_MAX = 2.0;

/** Turns an active strike runs before auto-resolving via wait-it-out if no concession has happened. */
export const STRIKE_DURATION_TURNS = 4;

/** Turns after ANY strike resolution (concession or waitout) before that sector can strike again. */
export const STRIKE_COOLDOWN_TURNS = 12;

/** Fraction of hourlyRevenue cut while a strike is active (throttled, not zeroed). */
export const STRIKE_REVENUE_THROTTLE = 0.25;

/** Additional margin-mod penalty (pp) while a strike is active. */
export const STRIKE_MARGIN_PENALTY_PP = -8;

/**
 * Unionization bump applied only on wait-it-out resolution (not concession,
 * a CEO who conceded already paid for it via a higher wageLevel; a sector
 * that waited it out without raising pay gets a "radicalization" bump
 * instead, since the workers won nothing).
 */
export const STRIKE_WAITOUT_UNIONIZATION_BUMP = 10;

/**
 * v3 Phase 7b: country-adjusted strike trigger threshold from union-law
 * bias. Pure, pass the result as `StrikeStepInputs.unionizationThreshold`.
 * `bias` absent/non-finite ⇒ 0 (neutral), same treatment as
 * `unionizationDriftTarget`'s own `unionLawBias` input.
 */
export function lawAdjustedUnionizationThreshold(bias: number | undefined): number {
  const b = typeof bias === "number" && Number.isFinite(bias) ? bias : 0;
  return STRIKE_UNIONIZATION_THRESHOLD - b * STRIKE_LAW_THRESHOLD_WEIGHT;
}

/**
 * Steps the persisted worker-expectation index toward `realWage` by at most
 * WORKER_EXPECTATION_TREND_STEP per turn, mirrors `trendUnionization`'s
 * step-limited, no-overshoot pattern (unionization.ts). `current` undefined
 * (first turn unions are on for this sector) initializes AT `realWage`, so
 * there's no spurious first-turn gap.
 */
export function trendWorkerExpectation(current: number | undefined, realWage: number): number {
  if (current === undefined || !Number.isFinite(current)) return realWage;
  if (current === realWage) return current;
  const diff = realWage - current;
  const step = Math.sign(diff) * Math.min(WORKER_EXPECTATION_TREND_STEP, Math.abs(diff));
  const next = current + step;
  return Math.max(WORKER_EXPECTATION_MIN, Math.min(WORKER_EXPECTATION_MAX, next));
}

/** Persisted strike state read from / written to a `CorporateSector`. */
export interface StrikeState {
  strikeStartedAtTurn: number | null;
  strikeCooldownUntilTurn: number | null;
}

export interface StrikeStepInputs {
  /** This turn's freshly-trended unionization (0-100). */
  unionization: number;
  /** This turn's real-wage index (see `realWageIndex` in unionization.ts). */
  realWage: number;
  /** This turn's freshly-trended worker expectation index. */
  workerExpectation: number;
  turn: number;
  prior: StrikeState;
  /**
   * v3 Phase 7b: country-adjusted trigger threshold, overriding
   * `STRIKE_UNIONIZATION_THRESHOLD`. Optional, every existing call site
   * omits this and gets the module default, so this is backward-compatible.
   * Only the TRIGGER condition is adjustable; the concession/waitout
   * resolution thresholds are unaffected by union-law bias.
   */
  unionizationThreshold?: number;
  /** v3 Phase 7b: country-adjusted trigger gap threshold, overriding `STRIKE_EXPECTATION_GAP_THRESHOLD`. */
  expectationGapThreshold?: number;
  /**
   * Union ban (player suggestion #93): true while the sector's country has
   * `FederalBudget.unionsBanned`. While banned, new strikes can never
   * trigger and any active strike ends on the next turn (resolved as
   * `"resolved_banned"`, no radicalization bump, the workers were outlawed,
   * not waited out). The cooldown is still planted on that forced
   * resolution, preserving the "every resolution path sets a cooldown"
   * degeneracy guard so a repeal can't instantly re-trigger the same strike.
   */
  unionsBanned?: boolean;
  /** Active collective agreement prevents a new strike in this local. */
  noStrikeProtected?: boolean;
  /**
   * Union dues v1: `servicesStrikeSoftening()` of the representing union's
   * active service slate, 0-`MAX_STRIKE_SOFTENING` (0.6), see
   * `src/lib/unions/unionServices.ts`. Damps the worker-expectation-vs-real-wage
   * gap that drives both the trigger and the concession threshold, so a union
   * running services makes its own sectors less strike-prone (harder to trigger,
   * easier to settle) without ever reaching 0: a fully-serviced sector is still
   * strikeable if the gap is big enough, on purpose. Absent/non-finite ⇒ 0.
   */
  strikeSoftening?: number;
}

export interface StrikeStepResult {
  next: StrikeState;
  event:
    | "started"
    | "resolved_concession"
    | "resolved_waitout"
    | "resolved_banned"
    | "resolved_agreement"
    | null;
  /** Unionization bump (pp) to apply this turn; 0 except on waitout. */
  unionizationBump: number;
}

/**
 * Pure strike state machine. See file docblock for the degeneracy-guard
 * reasoning (hysteresis gap, slow expectation index, cooldown on every
 * resolution path).
 */
export function stepStrike(inputs: StrikeStepInputs): StrikeStepResult {
  const { unionization, realWage, workerExpectation, turn, prior } = inputs;
  const unionizationThreshold = inputs.unionizationThreshold ?? STRIKE_UNIONIZATION_THRESHOLD;
  const expectationGapThreshold =
    inputs.expectationGapThreshold ?? STRIKE_EXPECTATION_GAP_THRESHOLD;
  const softening = Math.max(
    0,
    Math.min(1, Number.isFinite(inputs.strikeSoftening) ? (inputs.strikeSoftening as number) : 0)
  );
  // Softening damps the raw gap before either threshold sees it, so services
  // both raise the bar to trigger and lower the bar to concede, never zeroing
  // the gap outright (softening is capped below 1 by unionServices.ts).
  const gap = (workerExpectation - realWage) * (1 - softening);

  // Union ban (player suggestion #93): overrides the whole state machine,
  // an active strike is force-resolved (with cooldown, see StrikeStepInputs
  // docs) and the trigger below is unreachable while the ban holds.
  if (inputs.unionsBanned) {
    if (prior.strikeStartedAtTurn != null) {
      return {
        next: { strikeStartedAtTurn: null, strikeCooldownUntilTurn: turn + STRIKE_COOLDOWN_TURNS },
        event: "resolved_banned",
        unionizationBump: 0,
      };
    }
    return { next: prior, event: null, unionizationBump: 0 };
  }

  // A settlement is labor peace, not a ban. It ends an in-flight strike with
  // the normal cooldown and blocks new triggers for the negotiated period.
  if (inputs.noStrikeProtected) {
    if (prior.strikeStartedAtTurn != null) {
      return {
        next: { strikeStartedAtTurn: null, strikeCooldownUntilTurn: turn + STRIKE_COOLDOWN_TURNS },
        event: "resolved_agreement",
        unionizationBump: 0,
      };
    }
    return { next: prior, event: null, unionizationBump: 0 };
  }

  if (prior.strikeStartedAtTurn != null) {
    // Active strike, check resolution paths. Concession takes priority:
    // if the gap has closed enough, the CEO's wage move ends it immediately
    // regardless of elapsed duration.
    if (gap <= STRIKE_CONCESSION_GAP_THRESHOLD) {
      return {
        next: { strikeStartedAtTurn: null, strikeCooldownUntilTurn: turn + STRIKE_COOLDOWN_TURNS },
        event: "resolved_concession",
        unionizationBump: 0,
      };
    }
    const elapsed = turn - prior.strikeStartedAtTurn;
    if (elapsed >= STRIKE_DURATION_TURNS) {
      return {
        next: { strikeStartedAtTurn: null, strikeCooldownUntilTurn: turn + STRIKE_COOLDOWN_TURNS },
        event: "resolved_waitout",
        unionizationBump: STRIKE_WAITOUT_UNIONIZATION_BUMP,
      };
    }
    return { next: prior, event: null, unionizationBump: 0 };
  }

  // Not active, check trigger, but only outside cooldown.
  const inCooldown = prior.strikeCooldownUntilTurn != null && turn < prior.strikeCooldownUntilTurn;
  if (!inCooldown && unionization > unionizationThreshold && gap > expectationGapThreshold) {
    return {
      next: { strikeStartedAtTurn: turn, strikeCooldownUntilTurn: null },
      event: "started",
      unionizationBump: 0,
    };
  }
  return { next: prior, event: null, unionizationBump: 0 };
}
