/**
 * Retirement of capacity the market persistently will not buy (plants tier).
 *
 * ─── The problem ────────────────────────────────────────────────────────────
 *
 * The demand throttle holds a glutted plant at last turn's sales plus the probe
 * margin, so its output converges on what buyers take. Its CAPACITY never
 * does. Headcount is staffed for the whole active nameplate, idle units pay
 * IDLE_UPKEEP_FRACTION upkeep, and the only thing that ever shrinks owned stock
 * is CAPITAL_DEPRECIATION_PER_TURN (0.05% a turn, a half-life of over a
 * thousand turns). A plant built for a market ten times its real size pays
 * payroll and upkeep on the other nine tenths forever: on the live world a
 * media chain seeded at the same 204 sites in every state sold 13% of its run
 * in the small states and carried a labour bill several times its revenue.
 *
 * ─── The rule ───────────────────────────────────────────────────────────────
 *
 * Once a plant has been demand-limited into a glut for more than
 * IDLE_RETIRE_GRACE_TURNS consecutive turns, it retires a fixed share of the
 * capacity the market does not justify:
 *
 *     justified = capacity x throttle x (1 + IDLE_RETIRE_HEADROOM)
 *     retired   = IDLE_RETIRE_RATE x max(0, capacity - justified)
 *
 * `capacity x throttle` is the capacity that would make this turn's
 * demand-limited run at this turn's input, labour and policy rates, so a plant
 * that is ALSO input-starved keeps enough capacity to make its sales once
 * inputs recover; the throttle is computed after those legs. Retirement only
 * removes demand-idle units, never input-idle ones.
 *
 * It is exponential toward the justified size, so it is gradual by
 * construction (at most IDLE_RETIRE_RATE of a plant in one turn) and slows as
 * the plant approaches a size it can sell. At equilibrium the plant keeps
 * IDLE_RETIRE_HEADROOM above its demand-limited run, and the throttle's probe
 * margin can still climb into that room before anything retires again.
 *
 * ─── What does NOT retire ───────────────────────────────────────────────────
 *
 *  - A plant that sold out (fill at or above IDLE_RETIRE_GLUT_FILL). That is a
 *    plant ramping back into a recovering market; its throttle is below 1 only
 *    because it climbs by the probe margin, and the capacity it is climbing
 *    into is about to be used.
 *  - A plant whose throttle did not bind: its limit is inputs, labour, a
 *    disaster or the owner's policy, not demand.
 *  - Mothballed or partly parked plants. Cold storage is the owner's explicit
 *    choice to hold capacity, already billed at the cold upkeep rate.
 *  - Any plant before the streak passes the grace period, so a single bad
 *    clearing turn or a short demand shock retires nothing.
 *
 * NPP engine 6 adds one case for NPP-run corps only: a plant that sells out
 * but whose throttle stays under IDLE_RETIRE_STRUCTURAL_THROTTLE for
 * IDLE_RETIRE_STRUCTURAL_GRACE_TURNS is oversized, not recovering. It retires
 * toward its run with IDLE_RETIRE_STRUCTURAL_HEADROOM of room to grow back.
 * On live turn 202, loss-making NPP sectors ran at 38-46% utilization under
 * the throttle while selling 92-100% of output, paying payroll and upkeep on
 * the idle rest.
 *
 * Player plants (owner, 2026-10-17) get the same structural case with the
 * player settings: IDLE_RETIRE_STRUCTURAL_GRACE_TURNS of warning, then
 * IDLE_RETIRE_RATE a turn of the capacity beyond the run plus
 * IDLE_RETIRE_STRUCTURAL_HEADROOM. Without it a player plant the throttle holds
 * at a tenth of its size "sells out" every turn and never shrinks: on live turn
 * 260 player plants held 7.7M units beyond what their markets take, retiring at
 * 0.2% a turn against 15.5% for AI plants.
 */

/** Consecutive glutted turns a plant may run before any capacity retires. */
export const IDLE_RETIRE_GRACE_TURNS = 6;

/** Share of the unjustified capacity retired each turn once the grace has run. */
export const IDLE_RETIRE_RATE = 0.04;

/** Capacity kept above the demand-limited run, as a fraction of that run. */
export const IDLE_RETIRE_HEADROOM = 0.25;

/**
 * Sold share of last turn's output below which a demand-limited plant counts
 * as glutted. A throttled plant settles near 1 / (1 + probe margin), about
 * 0.87; a plant ramping into a recovering market sells everything it makes.
 */
export const IDLE_RETIRE_GLUT_FILL = 0.95;

/**
 * NPP engine 6: an NPP-run plant whose demand throttle stays below this share
 * of capacity is structurally oversized even when it sells everything it makes.
 * A recovering market lets the throttle climb by the probe margin each turn, so
 * a throttle that stays this low for the structural grace is not recovering.
 */
export const IDLE_RETIRE_STRUCTURAL_THROTTLE = 0.6;

/** Consecutive deeply-throttled turns an NPP-run plant may run before retiring. */
export const IDLE_RETIRE_STRUCTURAL_GRACE_TURNS = 6;

/** Glutted-turn grace for NPP-run plants; they shed idle capacity faster. */
export const NPP_IDLE_RETIRE_GRACE_TURNS = 2;

/** Share of the unjustified capacity an NPP-run plant retires each turn. */
export const NPP_IDLE_RETIRE_RATE = 0.15;

/** Headroom kept above the run for a structural retirement (room to grow back). */
export const IDLE_RETIRE_STRUCTURAL_HEADROOM = 0.5;

export interface IdleCapacityRetirementInput {
  plantsEnabled: boolean;
  mothballed: boolean;
  /** Active share of capacity, 0-1. Below 1 means the owner parked some. */
  activeFraction: number;
  /** This turn's demand throttle, in (0, 1]. */
  demandThrottleFactor: number;
  /**
   * Last turn's sold share of output, valued the way the throttle values it.
   * Null when there is no clearing signal.
   */
  demandFill: number | null | undefined;
  /** Persisted consecutive glutted turns before this one. */
  priorStreak: number | null | undefined;
  /** Plants transition ramp, 0 on the flip turn rising to 1. */
  rampLambda: number;
  /**
   * NPP engine 6, NPP-run corp: a sold-out plant held deeply under capacity by
   * the throttle for the structural grace also retires toward its run.
   */
  nppStructural?: boolean;
  /**
   * Player-run corp (not state-owned): the oversized case, on its own counter
   * (`priorOversizedTurns`) so a glutted spell can never use up the warning.
   */
  playerStructural?: boolean;
  /** Persisted consecutive oversized turns before this one (player plants). */
  priorOversizedTurns?: number | null;
  /** Last turn's demand throttle; a climbing throttle is a recovery, not oversizing. */
  priorThrottle?: number | null;
  /** New capacity landed this turn: the warning restarts for the new plant. */
  capacityLanded?: boolean;
  /**
   * NPP-run corp: glutted plants use the shorter NPP grace and faster NPP rate.
   * Player and autopilot plants leave this unset.
   */
  nppRun?: boolean;
}

export interface IdleCapacityRetirementResult {
  /** Consecutive glutted turns including this one; 0 resets the streak. */
  streak: number;
  /** Consecutive oversized turns including this one (player plants); 0 resets. */
  oversizedTurns: number;
  /** Share of owned capacity to retire this turn, in [0, NPP_IDLE_RETIRE_RATE]. */
  retireFraction: number;
}

export function idleCapacityRetirement(
  input: IdleCapacityRetirementInput
): IdleCapacityRetirementResult {
  const throttle = input.demandThrottleFactor;
  const fill = input.demandFill;
  const glutted =
    input.plantsEnabled &&
    !input.mothballed &&
    input.activeFraction >= 1 &&
    Number.isFinite(throttle) &&
    throttle > 0 &&
    throttle < 1 &&
    typeof fill === "number" &&
    Number.isFinite(fill) &&
    fill < IDLE_RETIRE_GLUT_FILL;
  const structural =
    !glutted &&
    input.nppStructural === true &&
    input.plantsEnabled &&
    !input.mothballed &&
    input.activeFraction >= 1 &&
    Number.isFinite(throttle) &&
    throttle > 0 &&
    throttle < IDLE_RETIRE_STRUCTURAL_THROTTLE;
  // Player oversized: sells what it makes, held deep under its size, and not
  // climbing back. A throttle that rose this turn is a recovery in progress (it
  // climbs only by the probe margin from the floor, about 13 turns to pass 0.6),
  // and freshly landed capacity always reads oversized at first; both restart
  // the warning instead of counting toward it.
  const priorThrottle = input.priorThrottle;
  const climbing =
    typeof priorThrottle === "number" &&
    Number.isFinite(priorThrottle) &&
    throttle > priorThrottle * 1.01;
  const oversized =
    !glutted &&
    input.playerStructural === true &&
    input.nppStructural !== true &&
    input.plantsEnabled &&
    !input.mothballed &&
    input.activeFraction >= 1 &&
    Number.isFinite(throttle) &&
    throttle > 0 &&
    throttle < IDLE_RETIRE_STRUCTURAL_THROTTLE &&
    !climbing &&
    input.capacityLanded !== true;
  if (oversized) {
    const priorOver =
      typeof input.priorOversizedTurns === "number" && Number.isFinite(input.priorOversizedTurns)
        ? Math.max(0, Math.floor(input.priorOversizedTurns))
        : 0;
    const oversizedTurns = priorOver + 1;
    if (oversizedTurns <= IDLE_RETIRE_STRUCTURAL_GRACE_TURNS) {
      return { streak: 0, oversizedTurns, retireFraction: 0 };
    }
    const excessShare = Math.max(0, 1 - throttle * (1 + IDLE_RETIRE_STRUCTURAL_HEADROOM));
    const ramp = Number.isFinite(input.rampLambda) ? Math.max(0, Math.min(1, input.rampLambda)) : 0;
    return { streak: 0, oversizedTurns, retireFraction: IDLE_RETIRE_RATE * excessShare * ramp };
  }
  if (!glutted && !structural) return { streak: 0, oversizedTurns: 0, retireFraction: 0 };

  const prior =
    typeof input.priorStreak === "number" && Number.isFinite(input.priorStreak)
      ? Math.max(0, Math.floor(input.priorStreak))
      : 0;
  const streak = prior + 1;
  const nppRun = input.nppRun === true || input.nppStructural === true;
  const grace = glutted
    ? nppRun
      ? NPP_IDLE_RETIRE_GRACE_TURNS
      : IDLE_RETIRE_GRACE_TURNS
    : IDLE_RETIRE_STRUCTURAL_GRACE_TURNS;
  if (streak <= grace) return { streak, oversizedTurns: 0, retireFraction: 0 };

  const headroom = glutted ? IDLE_RETIRE_HEADROOM : IDLE_RETIRE_STRUCTURAL_HEADROOM;
  const excessShare = Math.max(0, 1 - throttle * (1 + headroom));
  const rate = nppRun ? NPP_IDLE_RETIRE_RATE : IDLE_RETIRE_RATE;
  const ramp = Number.isFinite(input.rampLambda) ? Math.max(0, Math.min(1, input.rampLambda)) : 0;
  return { streak, oversizedTurns: 0, retireFraction: rate * excessShare * ramp };
}
