/**
 * Production factor for a plant's restart turn.
 *
 * Plain data in, plain data out: no clock, rng or ambient state.
 *
 * Clearing offers what a plant made last turn, so a plant that made nothing
 * last turn (back from mothball, first capacity just landed, a full outage) has
 * nothing on the market this turn whatever it makes. It runs only the restart
 * share, or what a supply contract needs if more, and the demand throttle takes
 * over from real sales next turn. This is a factor on production, never on the
 * demand throttle, so nothing that reads demand mistakes a restart for low
 * demand.
 */
export function restartProductionFactor(args: {
  restartRunShare: number;
  guaranteedUnits: number | null | undefined;
  plannedUnits: number;
}): number {
  const share = Number.isFinite(args.restartRunShare) ? args.restartRunShare : 1;
  if (share >= 1) return 1;
  const contractShare =
    typeof args.guaranteedUnits === "number" &&
    Number.isFinite(args.guaranteedUnits) &&
    args.plannedUnits > 0
      ? Math.max(0, args.guaranteedUnits) / args.plannedUnits
      : 0;
  return Math.min(1, Math.max(Math.max(0, share), contractShare));
}
