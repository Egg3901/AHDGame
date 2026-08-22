/**
 * Demand-aware production throttle (plants tier).
 *
 * ─── The problem ────────────────────────────────────────────────────────────
 *
 * Under plants a sector's revenue carries `soldFraction` (it rides
 * `clearingRevenueLeg`) but its COSTS do not. Inputs are billed at
 * `utilization = producedUnits / capacity`, labor at headcount, upkeep at
 * capacity, and the calibrated `otherOpexPerUnit` residual per produced unit.
 * Unsold output is not capitalised either — `market/inventory.ts` routes it to
 * a shadow global stock that deliberately does not feed prices yet.
 *
 * So a plant that makes 60k and sells 10k pays full freight on 60k and books
 * revenue on 10k. That is a structural loss no operator can manage out of, and
 * it is what players reported as margins of -254% and -500% that swing wildly
 * turn to turn (ticket #1072, and the same mechanism under #1129, #1139, #1153
 * and #1159). The margin swings because `otherOpexPerUnit` is solved ONCE, on
 * the sector's first physical-P&L turn, and then held — so a sector calibrated
 * at a healthy fill rate keeps paying that turn's cost basis forever.
 *
 * Nothing throttled output toward what buyers would take, so the loss
 * compounded every turn a market stayed glutted and the only lever a player had
 * was to mothball the whole sector.
 *
 * ─── The fix ────────────────────────────────────────────────────────────────
 *
 * Firms do not run flat out into a market that will not take the goods. Target
 * production at what the sector ACTUALLY SOLD last turn, plus a probe margin so
 * it keeps testing for more demand and can ramp back up:
 *
 *     target = priorSoldUnits x (1 + PROBE_MARGIN)
 *
 * Targeting absolute SOLD UNITS rather than a fraction is what makes this
 * stable. A fraction-based throttle oscillates: cut output to what sold, sell
 * all of it, read `soldFraction` as 1.0, produce full again, glut again. An
 * absolute target converges — sell 10k and you make 11.5k; sell all 11.5k and
 * you make 13.2k, ramping while demand absorbs it; sell only 10k of the 11.5k
 * and you settle back at 11.5k.
 *
 * ─── Flip identity ──────────────────────────────────────────────────────────
 *
 * A plant running at capacity and clearing it has a target ABOVE what it can
 * physically make, so the throttle returns 1 and the sector is byte-identical.
 * Only gluts move. A sector with no sales history (newly founded, first turn,
 * or a world that has never run the clearing pre-pass) is untouched too — there
 * is nothing to infer demand from yet.
 */

/**
 * How far above last turn's sales a plant keeps producing, so it can discover
 * demand it is not currently meeting and ramp back into a recovering market.
 * Without it a sector that ever throttled could never grow again.
 */
export const DEMAND_PROBE_MARGIN = 0.15;

/**
 * Floor on the throttle, as a fraction of what the plant would otherwise make.
 *
 * A sector that sold nothing at all still produces a probe run rather than
 * going dark: zero output means zero presence on the clearing book, which would
 * make "sold nothing" self-fulfilling and permanent. Mothballing is the
 * player's deliberate way to stop entirely, and it already zeroes production
 * upstream of this.
 */
export const DEMAND_THROTTLE_FLOOR = 0.1;

/**
 * Multiplier to apply to a plant's production, in [DEMAND_THROTTLE_FLOOR, 1].
 *
 * Returns exactly 1 whenever the throttle should not engage, so callers can
 * multiply unconditionally.
 *
 * @param plannedUnits  what the plant would produce with no demand signal
 * @param priorSoldUnits    units the sector sold last turn (persisted)
 * @param priorProducedUnits units it made last turn (persisted)
 */
export function demandThrottleFactor(
  plannedUnits: number,
  priorSoldUnits: number | null | undefined,
  priorProducedUnits: number | null | undefined
): number {
  if (!Number.isFinite(plannedUnits) || plannedUnits <= 0) return 1;
  // No usable history: nothing to infer demand from, so do not throttle. This
  // is the newly-founded sector and the pre-clearing world.
  if (
    typeof priorProducedUnits !== "number" ||
    !Number.isFinite(priorProducedUnits) ||
    priorProducedUnits <= 0
  ) {
    return 1;
  }
  if (typeof priorSoldUnits !== "number" || !Number.isFinite(priorSoldUnits)) return 1;

  // The target is ALWAYS last turn's sales plus the probe margin, including when
  // the plant cleared everything it made. Exempting a full clearance is what
  // reintroduces the oscillation this design exists to avoid: a throttled plant
  // sells all of its reduced run, is handed back full capacity on that basis,
  // and gluts again the very next turn. Ramping by the probe margin instead
  // lets it climb 15% a turn for as long as the market keeps absorbing.
  //
  // A plant already running at capacity and clearing it is unaffected, because
  // its target then exceeds what it can physically make and the cap below
  // returns 1.
  const sold = Math.max(0, priorSoldUnits);
  const target = sold * (1 + DEMAND_PROBE_MARGIN);
  if (target >= plannedUnits) return 1;
  return Math.max(DEMAND_THROTTLE_FLOOR, target / plannedUnits);
}
