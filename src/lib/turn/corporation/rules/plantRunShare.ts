/**
 * Share of a plant's active nameplate that is actually scheduled to run, for
 * staffing and the wage bill.
 *
 * Plain data in, plain data out: no clock, rng or ambient state.
 *
 * Headcount and payroll used to follow full active nameplate, so a plant the
 * demand throttle held at 10% of its run still staffed and paid 100% of its
 * crew. The run is the demand throttle: the share of the plant the market
 * asked for. Input throughput is deliberately left out: almost every sector
 * sits on the 0.85 throughput floor, so counting it would cut wages at plants
 * running flat out, which is not what this rule is for. Strikes, labour
 * rationing and the owner's production slider are deliberately left out:
 * rationing already shrinks headcount through the staffing factor (counting it
 * here would apply it twice), and a strike or a slider choice is not a
 * scheduling decision the payroll should follow.
 */
export function plantRunShare(args: { demandThrottleFactor: number }): number {
  const raw = args.demandThrottleFactor;
  if (!Number.isFinite(raw)) return 1;
  return Math.max(0, Math.min(1, raw));
}

/**
 * Crew share of active nameplate: the scheduled run, never below the floor.
 *
 * `ramp` is the governor ramp (0 on the flip turn, 1 once settled). It fades
 * the reduction in so the flip turn stays an exact no-op, the same discipline
 * the idle upkeep charge uses. A run of 1 returns exactly 1 at any ramp.
 */
export function plantCrewShare(args: {
  demandThrottleFactor: number;
  ramp: number;
  floor: number;
  /** Last turn's crew share (undefined on the first turn under this rule = 1). */
  previous?: number | null;
  /** Largest drop in crew share allowed in one turn (gradual layoffs). */
  maxDropPerTurn?: number;
}): number {
  const floor = Math.max(0, Math.min(1, args.floor));
  const run = plantRunShare(args);
  const settled = Math.max(floor, run);
  if (settled >= 1) return 1;
  const ramp = Number.isFinite(args.ramp) ? Math.max(0, Math.min(1, args.ramp)) : 1;
  const target = 1 - ramp * (1 - settled);
  // Owner, 2026-10-16: no overnight layoffs. The crew shrinks by at most
  // maxDropPerTurn of nameplate a turn toward the target; it grows back at once.
  const previous = Number.isFinite(args.previous)
    ? Math.max(0, Math.min(1, args.previous as number))
    : 1;
  const step = args.maxDropPerTurn;
  if (step === undefined || !Number.isFinite(step) || step <= 0) return target;
  return target >= previous ? target : Math.max(target, previous - step);
}

/**
 * Largest crew-share drop allowed this turn. The normal gradual-layoff cap,
 * except for a plant the throttle has held near its floor for at least
 * `graceTurns` glutted turns, which may shed faster (see
 * PLANT_CREW_SUSTAINED_GLUT_MAX_DROP_PER_TURN for the sizing and why it does
 * not reopen the economy-wide layoff the normal cap prevents).
 */
export function plantCrewMaxDropPerTurn(args: {
  demandThrottleFactor: number;
  /** Persisted glutted-turn streak before this turn (`demandIdleTurns`). */
  priorDemandIdleTurns: number | null | undefined;
  graceTurns: number;
  normalMaxDrop: number;
  sustainedMaxDrop: number;
  sustainedThrottle: number;
}): number {
  const streak = args.priorDemandIdleTurns;
  const sustained =
    Number.isFinite(args.demandThrottleFactor) &&
    args.demandThrottleFactor < args.sustainedThrottle &&
    typeof streak === "number" &&
    Number.isFinite(streak) &&
    streak >= args.graceTurns;
  return sustained ? Math.max(args.normalMaxDrop, args.sustainedMaxDrop) : args.normalMaxDrop;
}
