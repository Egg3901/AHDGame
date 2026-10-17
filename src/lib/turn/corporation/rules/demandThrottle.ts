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
 * ─── Mixed-output plants (ticket 1370) ──────────────────────────────────────
 *
 * `sector.soldUnits` is produced units times the sector's blended
 * `soldFraction`, and clearing blends its output legs by SUPPLY RATE, which is
 * the same as weighting them by value at BASE prices. That is the wrong scale
 * exactly when the throttle matters: a hardware plant (electronics 0.55,
 * software 0.15) sold every unit of electronics into a 36% world shortage
 * priced at 8x base, sold a tenth of its software into a glut priced at 2x,
 * read a blended 0.81, and was cut to the 10% floor. Every turn it sold out
 * again and every turn the target (0.81 x 1.15 < 1) shrank it, so the plant
 * could never climb back while its main market went unserved.
 *
 * `throttleSoldUnits` restates last turn's sales by the value buyers put on
 * each leg: per-leg fill weighted by rate x (price / base), at the same lagged
 * market prices clearing realizes against. A plant whose valuable output sells
 * ramps; a plant whose valuable output is the glutted leg still throttles, so
 * the guard against running flat out into a glut is unchanged. Single-output
 * sectors return `soldUnits` untouched.
 */
export function throttleSoldUnits(args: {
  /** Last turn's produced units (persisted). */
  producedUnits: number | null | undefined;
  /** Sales for the prior output, preferably freshly cleared (rate-blended). */
  soldUnits: number | null | undefined;
  /** Fill per output commodity for that same prior output. */
  soldByCommodity?: Partial<Record<string, number>> | null;
  /** The sector's output mix. */
  supplyRates?: Partial<Record<string, number>> | null;
  /** Lagged price over base for one output, in the sector's own market. */
  priceRatioFor: (commodity: string) => number | null | undefined;
}): number | null | undefined {
  const { producedUnits, soldUnits, soldByCommodity, supplyRates } = args;
  if (
    !soldByCommodity ||
    !supplyRates ||
    typeof producedUnits !== "number" ||
    !Number.isFinite(producedUnits) ||
    producedUnits <= 0
  ) {
    return soldUnits;
  }
  let weightSum = 0;
  let soldWeight = 0;
  let legs = 0;
  for (const [commodity, rate] of Object.entries(supplyRates)) {
    if (!(typeof rate === "number" && rate > 0)) continue;
    const fill = soldByCommodity[commodity];
    if (!(typeof fill === "number" && Number.isFinite(fill))) continue;
    const ratio = args.priceRatioFor(commodity);
    const weight =
      rate * (typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0 ? ratio : 1);
    weightSum += weight;
    soldWeight += weight * Math.max(0, Math.min(1, fill));
    legs += 1;
  }
  if (legs < 2 || !(weightSum > 0)) return soldUnits;
  return producedUnits * (soldWeight / weightSum);
}

/**
 * Run share a plant restarts at after a turn with no output. A quarter of the
 * plant goes on the market the next turn and grows from there; the throttle
 * floor (DEMAND_THROTTLE_FLOOR) would make a recovering market wait longer.
 */
export const RESTART_RUN_SHARE = 0.25;

/** Fill at or above this counts as a leg that sold everything it offered. */
export const SOLD_OUT_FILL = 0.99;

/**
 * Extra units a sold-out plant can put into a market that left buyers unserved
 * (ticket 1393).
 *
 * The throttle reads last turn's sales as the demand it can count on. That is
 * the right floor in a glut, but a plant that sold every unit it made into a
 * book where lagged demand exceeded lagged supply learned nothing about the
 * ceiling: buyers wanted more than anyone offered. Ramping 15% a turn from
 * there left a plant at a third of capacity for many turns while its own
 * market stayed short, and showed it as "Demand limited" beside "100% sold".
 *
 * Per output leg that sold out, the book's unmet demand (demand minus supply)
 * converts to sector units through the leg's share of the output mix. Legs are
 * blended by the same value weights `throttleSoldUnits` uses, so a plant whose
 * valuable output is short ramps and a glutted co-product still holds it back.
 * Each seller receives only its share of the normalized clearing book. The
 * allocations sum to at most the book's unmet demand. Capacity caps remain
 * in the throttle; unused allocations are not promised to another seller.
 */
export function soldOutMarketHeadroomUnits(args: {
  /** Fill per output commodity for the prior output in this scoped book. */
  soldByCommodity?: Partial<Record<string, number>> | null;
  /** The sector's output mix. */
  supplyRates?: Partial<Record<string, number>> | null;
  /** Share of one sector unit that is this output, as clearing splits offers. */
  mixWeightFor: (commodity: string) => number;
  /** This seller's normalized offer share in the same scoped clearing book. */
  marketShareFor?: (commodity: string) => number | null | undefined;
  /** Lagged balance of the book this output clears in. */
  balanceFor: (commodity: string) => { supply: number; demand: number } | null | undefined;
  /** Lagged price over base for one output, in the sector's own market. */
  priceRatioFor: (commodity: string) => number | null | undefined;
}): number {
  const { soldByCommodity, supplyRates } = args;
  if (!soldByCommodity || !supplyRates) return 0;
  let weightSum = 0;
  let headroomWeight = 0;
  for (const [commodity, rate] of Object.entries(supplyRates)) {
    if (!(typeof rate === "number" && rate > 0)) continue;
    const fill = soldByCommodity[commodity];
    if (!(typeof fill === "number" && Number.isFinite(fill))) continue;
    const ratio = args.priceRatioFor(commodity);
    const weight =
      rate * (typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0 ? ratio : 1);
    weightSum += weight;
    if (fill < SOLD_OUT_FILL) continue;
    const share = args.mixWeightFor(commodity);
    const balance = args.balanceFor(commodity);
    if (!(share > 0) || !balance) continue;
    const unmet = balance.demand - balance.supply;
    if (!(Number.isFinite(unmet) && unmet > 0)) continue;
    const marketShare = args.marketShareFor?.(commodity);
    if (!(typeof marketShare === "number" && Number.isFinite(marketShare))) continue;
    headroomWeight += weight * (unmet / share) * Math.max(0, Math.min(1, marketShare));
  }
  if (!(weightSum > 0)) return 0;
  return headroomWeight / weightSum;
}

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
 * @param guaranteedDemandUnits named-buyer demand that must be met, in the
 * same scalar output units as `plannedUnits`
 * @param marketHeadroomUnits unmet demand a sold-out plant may add on top of
 * what it sold, from `soldOutMarketHeadroomUnits`
 */
export function demandThrottleFactor(
  plannedUnits: number,
  priorSoldUnits: number | null | undefined,
  priorProducedUnits: number | null | undefined,
  guaranteedDemandUnits?: number | null,
  marketHeadroomUnits?: number | null
): number {
  if (!Number.isFinite(plannedUnits) || plannedUnits <= 0) return 1;
  const contractShare =
    typeof guaranteedDemandUnits === "number" && Number.isFinite(guaranteedDemandUnits)
      ? Math.max(0, guaranteedDemandUnits) / plannedUnits
      : 0;
  // Restart: the plant ran before and made nothing last turn (mothballed,
  // idle, or its first capacity just landed). Clearing offers last turn's
  // output, so this turn it has nothing on the market and sells nothing
  // whatever it makes. Running it flat out paid full inputs for unsold output
  // (live turn 253: 49 restarted media plants sold 0 of 6M units). It starts
  // at RESTART_RUN_SHARE, plus any contracted volume, and the probe and
  // sold-out headroom ramp it from real sales from the next turn.
  if (
    typeof priorProducedUnits === "number" &&
    Number.isFinite(priorProducedUnits) &&
    priorProducedUnits <= 0
  ) {
    return Math.min(1, Math.max(RESTART_RUN_SHARE, contractShare));
  }
  // No history at all (pre-clearing world, never run): nothing to infer demand
  // from, so do not throttle.
  if (typeof priorProducedUnits !== "number" || !Number.isFinite(priorProducedUnits)) {
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
  const headroom =
    typeof marketHeadroomUnits === "number" && Number.isFinite(marketHeadroomUnits)
      ? Math.max(0, marketHeadroomUnits)
      : 0;
  const marketTarget = Math.max(sold * (1 + DEMAND_PROBE_MARGIN), sold + headroom);
  const contractTarget =
    typeof guaranteedDemandUnits === "number" && Number.isFinite(guaranteedDemandUnits)
      ? Math.max(0, guaranteedDemandUnits)
      : 0;
  // A named buyer is a real demand signal. It must lift a supplier above the
  // open-market run rate, otherwise the contract reservation arrives only
  // after production has already been throttled and can never fill promptly.
  const target = Math.max(marketTarget, contractTarget);
  if (target >= plannedUnits) return 1;
  return Math.max(DEMAND_THROTTLE_FLOOR, target / plannedUnits);
}

/**
 * A lagged book balance with the ledger's truncated demand restored pro rata.
 * `factor` is (capped + truncated) / capped for the commodity worldwide; a
 * missing or non-lifting factor returns the balance unchanged.
 */
export function withLatentDemand(
  balance: { supply: number; demand: number } | null | undefined,
  factor: number | null | undefined
): { supply: number; demand: number } | null | undefined {
  if (!balance || !(typeof factor === "number" && Number.isFinite(factor) && factor > 1)) {
    return balance;
  }
  return { supply: balance.supply, demand: balance.demand * factor };
}

/**
 * Book balance plus foreign buyers nobody serves.
 *
 * An exporter's clearing book pins demand to supply (its surplus is cleared
 * abroad), so `demand - supply` reads zero however short its foreign buyers
 * are, and a sold-out exporter could only creep up by the probe margin. The
 * trade snapshot's `unmetForeignDemand` is this country's gravity share of the
 * deficits no one is serving, so adding it restores the room the exporter can
 * actually win. Other exporters claim their own shares, not this one.
 */
export function withForeignDemand(
  balance: { supply: number; demand: number } | null | undefined,
  unmetForeignDemand: number | null | undefined
): { supply: number; demand: number } | null | undefined {
  if (
    !balance ||
    !(typeof unmetForeignDemand === "number" && Number.isFinite(unmetForeignDemand)) ||
    unmetForeignDemand <= 0
  ) {
    return balance;
  }
  return {
    supply: balance.supply,
    demand: balance.demand + unmetForeignDemand * FOREIGN_DEMAND_CLAIM_PER_TURN,
  };
}

/**
 * Share of the unserved foreign deficit an exporter may claim as room in one
 * turn. The gravity share ignores route caps and tariff budgets, so claiming it
 * whole could send a plant straight to capacity into routes that cannot carry
 * it. A quarter a turn ramps over a few turns, and each turn re-reads what the
 * last one actually shipped.
 */
export const FOREIGN_DEMAND_CLAIM_PER_TURN = 0.25;

/**
 * Per-output fill for production feedback, with units a media ownership law
 * refused added back. Those units had buyers, so a capped outlet keeps its run
 * instead of reading the legal limit as weak demand. Clamped to a full fill.
 */
export function withRegulationBlockedFill<T extends string>(
  soldByCommodity: Partial<Record<T, number>> | null | undefined,
  blockedByCommodity: Partial<Record<T, number>> | null | undefined
): Partial<Record<T, number>> | null | undefined {
  if (!soldByCommodity || !blockedByCommodity) return soldByCommodity;
  const fill: Partial<Record<T, number>> = { ...soldByCommodity };
  for (const [commodity, blocked] of Object.entries(blockedByCommodity) as [T, number][]) {
    const sold = fill[commodity];
    if (typeof sold !== "number" || !(blocked > 0)) continue;
    fill[commodity] = Math.min(1, sold + blocked);
  }
  return fill;
}
