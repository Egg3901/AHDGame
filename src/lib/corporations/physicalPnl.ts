/**
 * Physical sector P&L (plants tier, wave P3.5).
 *
 * ─── What this replaces ──────────────────────────────────────────────────────
 *
 * Below the plants tier a sector's operating cost is one opaque line:
 *
 *     costs = revenue × (1 − effectiveProfitMargin / 100)
 *
 * `effectiveProfitMargin` is `sector.profitMargin` plus ~25 additive
 * percentage-point modifiers (commodity balances, tech, tariffs, subsidies,
 * macro, disasters, …). Every one of them is an *assertion about profitability*
 * rather than a statement about what the firm buys. Two consequences:
 *
 *  1. A sector's cost cannot move with the price of the things it consumes.
 *     Steel doubling shows up (if at all) as a few percentage points of margin
 *     modifier derived from a supply/demand *balance*, never as a bill.
 *  2. The same real-world condition is priced twice — once by the market
 *     (clearing, price realization) and again by a margin modifier standing in
 *     for the same thing.
 *
 * Under plants, cost becomes a sum of physical lines:
 *
 *     profit = revenue
 *              − inputsCost      (units consumed × lagged commodity price)
 *              − laborCost       (workers × wage, already physical)
 *              − upkeep          (P3a idle / mothball capacity charge)
 *              − complianceCost  (regulatory burden)
 *              − otherOpex       (the calibration residual, per unit)
 *              − financialLegs   (disaster penalties etc., ₳ passthrough)
 *              − growthCost      (unchanged, its own line)
 *
 * ─── The calibration identity (why the flip is a no-op) ──────────────────────
 *
 * `otherOpexPerUnit` is not a designed number. It is SOLVED, once, on the
 * sector's first physical-P&L turn, so that
 *
 *     Σ physical lines  ==  the margin formula's cost, exactly, at that state.
 *
 * The solved value is persisted (`otherOpexPerUnitAnchor`, ₳ per output unit
 * per turn) and then held. From that turn on the physical lines move on their
 * own: input prices move → the input bill moves → profit moves → the (now
 * DERIVED) margin moves. The old formula would have been blind to all of it.
 *
 * This is the same discipline P2 applied to revenue, pointed at costs: prove
 * the new model reproduces the old one byte-for-byte at the switchover, then
 * let it diverge for reasons you can name.
 *
 * The residual is also where the margin modifiers that are NOT physical keep
 * living. They are carried as a multiplicative drift factor on the anchor
 * (`otherOpexDriftFactor`), normalized to 1 at calibration — so subsidies,
 * tariffs, macro drag and the rest still move cost, but through one named
 * channel instead of being the whole cost model.
 *
 * Every function here is pure. Money is ₳ (economic anchor), per TURN (hourly),
 * matching `hourlyRevenue` in `sectorTurn`. Units are output units per turn.
 */

import type { CommodityType } from "@/lib/constants/commodities";
import { priceRealizationFactor } from "@/lib/market/priceRealization";

/** One commodity's consumption line for a turn. */
export interface InputLine {
  commodity: CommodityType;
  /** Units consumed this turn. */
  units: number;
  /** Price actually charged per unit (lagged market price, ₳). */
  unitPrice: number;
  /** units × unitPrice, ₳ this turn. */
  cost: number;
}

export interface InputsCostResult {
  /** Σ line.cost, ₳ this turn. */
  total: number;
  lines: InputLine[];
}

/**
 * Merge a country's reachable price ratio onto the world ratio for the
 * plant input bill.
 *
 * Reachable books in partitioned markets can print far above the world
 * (live US iron ~3.27 vs world ~0.77). The input bill now prices through the
 * same realization damping revenue does (`ratio^0.5`, max 1.5x, see
 * `computeInputsCost`), so capping the ratio here still matters: it lowers the
 * value fed into that factor rather than a raw linear price. Taking the cheaper
 * of the two keeps cheap-local discounts (the original overlay) without
 * charging buyers a cost no seller-side leg can recover.
 *
 * Ticket #1120 (Dangote / manufacturing) is the same t175 cliff as the
 * worldwide margin collapse: uncapped reachable input prices.
 */
export function capInputPriceRatioAtWorld(
  worldRatio: number | undefined,
  reachableRatio: number
): number {
  if (typeof worldRatio === "number" && Number.isFinite(worldRatio)) {
    return Math.min(worldRatio, reachableRatio);
  }
  return reachableRatio;
}

/**
 * Physical input bill for one sector-turn.
 *
 * Units consumed are the SAME quantity the world commodity ledger books as this
 * sector's demand (`computeRawSupplyDemand`, plants branch):
 *
 *     units_c = (nominalDailyRevenue × rate_c / basePrice_c)
 *               × utilization × inputMultiplier ÷ turnsPerDay
 *
 * — i.e. the recipe rate converted to units at the commodity's BASE price, then
 * scaled by how hard the plant actually ran (P3b's utilization scaling: a plant
 * at 60% buys ~60% of its inputs) and by the production-policy input multiplier.
 * Keeping this close to the ledger matters: the firm should be billed for the
 * same units the world is told it took, or money and goods stop describing the
 * same event.
 *
 * FOUR KNOWN DIVERGENCES from the ledger's demand branch, audited and kept
 * (each is a pre-existing shape of the ledger, not something this file
 * introduced). All four are LEVEL differences, so the calibration solve absorbs
 * them whole on the sector's first producing turn — they only bite to the
 * extent the factor MOVES afterwards:
 *
 *  1. `demandMultiplier` — the ledger scales retail input demand by the
 *     retail/GDP multiplier (bounded [0.5, 2.0]) and by world-event sector
 *     demand modifiers. Neither is reachable from the sector turn, so the bill
 *     does not carry them. A retail sector in a booming state can therefore be
 *     billed for up to half the units the ledger books it taking. Plumbing the
 *     multiplier through `CorporationLookups` is the fix; it is a lookups
 *     change, not a formula change.
 *  2. `natcorpScale` — the ledger books a natcorp at 0.25% of its flows (a
 *     world-flow dampener, not a claim the plant buys less). Applying it here
 *     would hand natcorps a 400x input discount, so the bill is deliberately
 *     full-rate.
 *  3. Tech input effects — `rates` here are tech-scaled (`effectiveDemand`);
 *     the ledger recomputes raw strategy rates and has never carried tech. The
 *     bill is the more correct of the two.
 *  4. One-turn lag — the ledger reads the PERSISTED `sector.revenue` (last
 *     turn's restated nameplate); this reads the current turn's
 *     `plantsNameplateRevenue`. Identical for a sector whose capacity did not
 *     move, one turn stale while it is building.
 *
 * The PRICE is the lagged market price passed through the SAME realization
 * function the revenue side uses: `basePrice × priceRealizationFactor(ratio)`,
 * i.e. clamp(ratio^0.5, 0.7, 1.5). The ratio comes from the prior turn's
 * commodity-price pass — the same one-turn lag that breaks the
 * price→revenue→supply→price loop. Absent ratio ⇒ factor 1 ⇒ base price.
 * Buy-sell symmetry is the invariant: a corp sells into a damped, clamped
 * market and buys from the same one, so world inflation squeezes margins
 * proportionally instead of unboundedly on the cost side only.
 *
 * Note the ratio is what makes the bill move: units cancel the base price, so
 * `cost_c = revenueBasis × rate_c × priceRealizationFactor(priceRatio_c)`. At
 * ratio 1 across the board the bill is exactly the recipe's nominal input
 * share of revenue.
 *
 * `rates` should already carry tech `inputCost` effects (they are input-rate
 * multipliers — see the tech disposition table in `sectorTurn`), so an
 * efficiency tech shows up as fewer units bought, not as a margin bonus.
 *
 * `statePremiums` (money wiring step 5, config-gated) adds the sector's home
 * state's landed-price surcharge for out-of-state sourcing on top of the
 * global ratio: unitPrice = basePrice × ratio + premium. Same one-turn lag as
 * the price ratios (the premium comes from last turn's sourcing pass).
 * Omitted or empty ⇒ output is byte-identical to the pre-money-wiring formula.
 */
export function computeInputsCost(args: {
  /**
   * Daily nominal revenue basis for the recipe (₳/day). Under plants this is
   * capacity × mixPrice — the nameplate the recipe rates are expressed against.
   */
  nominalDailyRevenue: number;
  /** Commodity → input rate (share of nominal revenue), tech-scaled. */
  rates: Partial<Record<CommodityType, number>>;
  /** Commodity → base price. */
  basePrices: Readonly<Record<CommodityType, number>>;
  /** Commodity → lagged price ÷ base price. Missing ⇒ 1. */
  priceRatios: ReadonlyMap<CommodityType, number>;
  /** producedUnits ÷ capacity, clamped to [0,1]. 1 when capacity is unknown. */
  utilization: number;
  /** Production-policy input multiplier (`getInputMultiplier`). */
  inputMultiplier: number;
  /** Turns per game day — converts the daily basis to this turn's bill. */
  turnsPerDay: number;
  /** Mothballed plants are cold: no production, no inputs. */
  mothballed?: boolean;
  /**
   * Commodity → landed-price premium per unit (₳), for the sector's home
   * state. Absent or empty leaves unitPrice unchanged (pre-money-wiring
   * behavior).
   */
  statePremiums?: ReadonlyMap<CommodityType, number>;
}): InputsCostResult {
  const {
    nominalDailyRevenue,
    rates,
    basePrices,
    priceRatios,
    utilization,
    inputMultiplier,
    turnsPerDay,
    mothballed,
    statePremiums,
  } = args;
  if (
    mothballed === true ||
    !Number.isFinite(nominalDailyRevenue) ||
    nominalDailyRevenue <= 0 ||
    !(turnsPerDay > 0)
  ) {
    return { total: 0, lines: [] };
  }
  const util = Number.isFinite(utilization) ? Math.max(0, Math.min(1, utilization)) : 1;
  const inputMult = Number.isFinite(inputMultiplier) ? Math.max(0, inputMultiplier) : 1;
  const lines: InputLine[] = [];
  let total = 0;
  for (const key of Object.keys(rates) as CommodityType[]) {
    const rate = rates[key] ?? 0;
    const basePrice = basePrices[key];
    if (!(rate > 0) || !(basePrice > 0)) continue;
    const units = ((nominalDailyRevenue * rate) / basePrice / turnsPerDay) * util * inputMult;
    if (!(units > 0)) continue;
    const ratio = priceRatios.get(key);
    const premium = statePremiums?.get(key);
    // Buy-sell symmetry: the bill prices through the SAME realization function
    // revenue does (clamp(ratio^0.5, 0.7, 1.5), priceRealization.ts). Before
    // this, a seller realized at most 1.5x base on a shortage while paying raw
    // linear ratios (2.5-3x) for the same shortage on the buy side, so any
    // recipe with fat input rates went structurally negative the moment the
    // world inflated — regardless of how well the corp was run (corp 445:
    // recipe 0.72 of nameplate billed at ~1.33x nameplate while revenue
    // realized ~1.5x, margin -19.8%). Same damping, same clamp, both legs.
    const unitPrice =
      basePrice * priceRealizationFactor(Number.isFinite(ratio) ? (ratio as number) : null) +
      (Number.isFinite(premium) && (premium as number) > 0 ? premium! : 0);
    const cost = units * unitPrice;
    if (!Number.isFinite(cost)) continue;
    total += cost;
    lines.push({ commodity: key, units, unitPrice, cost });
  }
  return { total, lines };
}

/**
 * The financial (non-physical) cost legs, charged as ₳ passthrough.
 *
 * These are margin penalties that are NOT claims about what the plant buys —
 * a disaster does not raise the price of steel, it destroys throughput and
 * imposes losses. They are converted from percentage points of revenue to ₳
 * once, here, and added as their own line so they survive the physical rewrite
 * unchanged and stay attributable.
 *
 * Only NEGATIVE (penalty) modifiers become costs; a positive modifier would be
 * a subsidy-shaped thing and belongs in the margin stack the residual carries.
 */
export function computeFinancialLegs(args: {
  hourlyRevenue: number;
  /** Percentage-point margin modifiers that are financial, not physical. */
  marginPenaltyPp: number;
}): number {
  const { hourlyRevenue, marginPenaltyPp } = args;
  if (!Number.isFinite(hourlyRevenue) || hourlyRevenue <= 0) return 0;
  if (!Number.isFinite(marginPenaltyPp) || marginPenaltyPp >= 0) return 0;
  return hourlyRevenue * (-marginPenaltyPp / 100);
}

/**
 * Solve the calibration residual.
 *
 * `marginFormulaCost` is what the OLD formula would have charged for
 * maintenance (labor included) at this turn's state. Everything the physical
 * model can name is subtracted; whatever is left is the sector's other
 * operating cost, expressed PER OUTPUT UNIT so it scales with production
 * instead of with revenue (a plant running at half throughput has roughly half
 * the other opex; under the margin formula it had exactly half, by
 * construction, which is the one thing the formula got right).
 *
 * Returns null when there is no production to divide by — the caller then
 * defers calibration to a later turn and charges the residual directly, which
 * is exact either way.
 *
 * The residual CAN be negative (a sector whose named physical costs already
 * exceed the margin formula's total). That is kept, not clamped: clamping would
 * break the identity, which is the entire point of this function. It shows up
 * as a sector whose physical costs are ahead of its calibrated total, and the
 * right response is to fix the input rates, not to hide it.
 */
export function solveOtherOpexPerUnit(args: {
  marginFormulaCost: number;
  laborCost: number;
  inputsCost: number;
  financialLegs: number;
  producedUnits: number;
}): number | null {
  const { marginFormulaCost, laborCost, inputsCost, financialLegs, producedUnits } = args;
  if (!(producedUnits > 0) || !Number.isFinite(producedUnits)) return null;
  const residual = marginFormulaCost - laborCost - inputsCost - financialLegs;
  if (!Number.isFinite(residual)) return null;
  return residual / producedUnits;
}

/**
 * The drift factor applied to a held `otherOpexPerUnitAnchor`.
 *
 * HISTORY: this ratio originally carried the whole non-physical margin stack
 * (subsidies, tariffs, tech margin bonuses, …) every turn. That inverted on
 * any sector whose residual anchor was negative — the stack shrank a CREDIT,
 * so a margin bonus raised cost. Those modifiers now ride `policyCredit` on
 * the revenue side (see `PhysicalPnl.policyCredit`), and this factor is only
 * a one-time REBASE of legacy anchors: callers pass the policy-neutral basis
 * (`1 − baseMargin/100`) as `currentMarginBasis`, so anchors stamped under the
 * old discipline (whose stored basis includes calibration-time modifiers) are
 * scaled onto the neutral basis using the model's own proportionality
 * assumption. Anchors stamped after the change store the neutral basis and
 * the factor is 1.
 *
 *     drift = basis_neutral ÷ basis_at_calibration
 *
 * A degenerate basis (a sector calibrated at exactly 100% margin, i.e. zero
 * cost) leaves the anchor undriven at 1 rather than dividing by ~0.
 */
export function otherOpexDriftFactor(args: {
  currentMarginBasis: number;
  anchorMarginBasis: number | null | undefined;
}): number {
  const { currentMarginBasis, anchorMarginBasis } = args;
  if (
    typeof anchorMarginBasis !== "number" ||
    !Number.isFinite(anchorMarginBasis) ||
    Math.abs(anchorMarginBasis) < 1e-9 ||
    !Number.isFinite(currentMarginBasis)
  ) {
    return 1;
  }
  const factor = currentMarginBasis / anchorMarginBasis;
  return Number.isFinite(factor) ? factor : 1;
}

/**
 * Re-base a held `otherOpexPerUnitAnchor` across a strategy retool.
 *
 * The anchor is ₳ PER OUTPUT UNIT, and that is what makes it survive capacity
 * growth, mothballing, throttling and sector merges untouched: double the
 * plant, double the units, double the bill, same rate. A RETOOL is the one
 * event that breaks the assumption, because it does not change how many units
 * there are — it changes what a unit IS. `setSectorStrategy` rescales
 * `capitalStock` by `capacityRescaleRatio` precisely so that the nameplate
 * (capacity × mixPrice) is invariant while the unit count moves by the RPU
 * ratio, which reaches 327x for a coal ↔ rare-earth pair. An anchor left alone
 * across that would be multiplied by the same 327x the unit count moved,
 * turning the residual operating cost into a plant-killing (or free) line for
 * no reason a player could name.
 *
 * So the anchor moves by the INVERSE: `anchor / ratio`, which holds
 * `anchor × units` — the actual ₳ charged — exactly fixed across the retool.
 * Composing a retool with its cancellation restores the original anchor, the
 * same invertibility `capitalStock` and the build queue already guarantee.
 *
 * Returns null when there is no anchor to move (a sector that has not been
 * calibrated yet) or the ratio is degenerate — the caller then writes nothing
 * and the sector calibrates fresh on its next producing turn, which is exact.
 */
export function rescaleOtherOpexAnchorForRetool(
  anchor: number | null | undefined,
  rescaleRatio: number
): number | null {
  if (typeof anchor !== "number" || !Number.isFinite(anchor)) return null;
  if (!Number.isFinite(rescaleRatio) || rescaleRatio <= 0) return null;
  const rescaled = anchor / rescaleRatio;
  return Number.isFinite(rescaled) ? rescaled : null;
}

/**
 * The units of capacity an idle-upkeep charge may honestly be levied on.
 *
 * ─── The defect this fixes ───────────────────────────────────────────────────
 *
 * `IDLE_UPKEEP_FRACTION` exists to make OVER-BUILDING cost something: capacity
 * you bought and do not use is not free to hold. That is a statement about an
 * OWNER'S DECISION. The charge was implemented against `capacity −
 * producedUnits`, which is not that number — it is every reason the plant ran
 * short, including the ones the owner did not pick.
 *
 * Measured on the live 12-player sandbox at turn 293 (675 sectors, `plants` on
 * since turn 240): `throughputFactor` was **exactly 0.85 for all 675 sectors**
 * — i.e. every plant in the world was pinned at the launch-safety governor's
 * floor (`1 − MARKET_REALIZATION_DEVIATION_CAP`), input-starved, with raw
 * throughput below the floor. Not one sector's idleness was an overbuild. The
 * charge was therefore billing a world-wide input shortage as if 675 owners had
 * each independently chosen to build 15% too much plant.
 *
 * It is also a DOUBLE charge. `throughputFactor` is already a term in
 * `baselineHourlyRevenue`: an input-starved plant loses that 15% off its top
 * line first, and was then billed upkeep on the same 15% of units. One
 * constraint, priced twice, in opposite directions.
 *
 * ─── What is charged instead ────────────────────────────────────────────────
 *
 * The involuntary throttles are divided back out, leaving the capacity that
 * would STILL have stood idle in a world that was not throttling the sector:
 *
 *     ownerIdleUnits = max(0, capacity − producedUnits ÷ involuntaryThrottle)
 *
 * `involuntaryThrottle` is the product of the production legs the owner cannot
 * choose — input throughput, the physical leg of an active disaster, a strike,
 * the extraction hard-minimum, a nationalisation transition. The legs the owner
 * DOES choose stay in: throttling the production policy slider to 60% still
 * idles 40% of the plant and is still billed for it, which is the case the
 * constant was written for.
 *
 * A throttle of 0 (a totally halted plant — full embargo, total disaster stop)
 * returns 0 idle units rather than dividing by zero: a plant the world has
 * switched off is not an overbuild either, and MOTHBALL_UPKEEP_FRACTION is the
 * deliberate, player-chosen path that does carry a charge.
 *
 * Genuine overbuild under plants shows up on the SALES side (`soldFraction`,
 * clearing) rather than as idle units, so this narrowing does not leave the
 * over-builder untouched — it stops the mechanic from punishing the wrong firm.
 */
export function ownerIdleUnits(args: {
  capacity: number;
  producedUnits: number;
  /** Product of the production legs the owner did not choose. */
  involuntaryThrottle: number;
}): number {
  const { capacity, producedUnits, involuntaryThrottle } = args;
  if (!Number.isFinite(capacity) || capacity <= 0) return 0;
  if (!Number.isFinite(involuntaryThrottle) || involuntaryThrottle <= 0) return 0;
  // Capped at 1: a "throttle" above 1 is a boost, and dividing by it would
  // MANUFACTURE idle units out of a productivity gain. Only a genuine
  // restriction may narrow the base.
  const throttle = Math.min(1, involuntaryThrottle);
  const produced = Number.isFinite(producedUnits) ? Math.max(0, producedUnits) : 0;
  const couldHaveRun = Math.min(capacity, produced / throttle);
  const idle = capacity - couldHaveRun;
  return Number.isFinite(idle) ? Math.max(0, idle) : 0;
}

/**
 * The per-unit price of idle upkeep, ₳ per output unit per turn.
 *
 * ─── Why this is no longer `(1 − margin_now)` ───────────────────────────────
 *
 * Idle upkeep was priced at `mixPrice × (1 − effectiveMargin/100)`, i.e. the
 * live cost ratio. That makes the charge GROW as the margin falls — a sector
 * whose margin drops from 45 to 12 sees its idle bill per unit rise by 1.6x at
 * the exact moment it can least carry it, and a sector at a negative derived
 * margin sees it rise without bound. On the live sandbox the deepest
 * loss-makers (the Eastern-bloc extraction and agriculture SOEs, seeded at
 * `profitMargin` 12) were paying the HIGHEST unit price in the world for the
 * privilege of being input-starved. That is a positive feedback loop pointed at
 * insolvency, and nothing in the design asked for it.
 *
 * It is also wrong on its own terms. The docblock on `IDLE_UPKEEP_FRACTION`
 * describes the charge as "fixed site/maintenance/skeleton crew" — a FIXED
 * cost. A fixed cost does not float with this quarter's margin.
 *
 * So the basis is ANCHORED, in exactly the discipline `otherOpexPerUnitAnchor`
 * already uses: stamped once from the live margin on the sector's first plants
 * turn (so the stamping turn is unchanged, byte for byte, including for a
 * mothballed sector where no ramp hides the difference), then HELD. Absent an
 * anchor — a legacy row, a sector that has not run a plants turn — it falls
 * back to the live basis, which is the pre-change behaviour.
 *
 * Clamped to [0, 1]: a basis above 1 would be a sector whose costs exceed its
 * revenue claiming an idle unit costs more than a running one, and a negative
 * basis would pay the owner to hold idle plant.
 */
export function idleUpkeepUnitPrice(args: {
  mixPrice: number;
  turnsPerDay: number;
  /** Held `1 − margin/100` from the sector's first plants turn, when present. */
  anchoredMarginBasis: number | null | undefined;
  /** Live `1 − margin/100`, used only when there is no anchor yet. */
  liveMarginBasis: number;
}): number {
  const { mixPrice, turnsPerDay, anchoredMarginBasis, liveMarginBasis } = args;
  if (!Number.isFinite(mixPrice) || mixPrice <= 0) return 0;
  if (!Number.isFinite(turnsPerDay) || turnsPerDay <= 0) return 0;
  const raw =
    typeof anchoredMarginBasis === "number" && Number.isFinite(anchoredMarginBasis)
      ? anchoredMarginBasis
      : liveMarginBasis;
  const basis = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
  return (mixPrice / turnsPerDay) * basis;
}

/** The assembled physical cost stack for one sector-turn. */
export interface PhysicalPnl {
  inputsCost: number;
  laborCost: number;
  upkeep: number;
  complianceCost: number;
  otherOpex: number;
  financialLegs: number;
  growthCost: number;
  /**
   * The policy/tech margin stack (subsidies, tariffs, home location, state
   * metrics, SOE efficiency, tech marginBonus, …) as ₳ this turn:
   * `hourlyRevenue × policyPp / 100`. Positive is a credit (reduces cost),
   * negative a charge. This replaced the drift factor on `otherOpex` as the
   * carrier for non-physical margin modifiers: the drift ratio INVERTED on any
   * sector whose calibrated residual was negative (a margin bonus shrank the
   * credit and raised cost — live on 82% of prod sectors when found), while a
   * revenue-proportional line is monotone in the modifier by construction.
   */
  policyCredit: number;
  /**
   * The like-for-like replacement of the old `grossMaintenance` line:
   * inputs + labor + otherOpex + financialLegs. Upkeep, compliance and growth
   * are NOT in it — they were separate lines before this wave too, and the
   * derived margin below has to compare against the same thing the margin
   * formula described.
   */
  operatingCost: number;
  /** Every line: what the corp actually pays this turn. */
  totalCost: number;
  profit: number;
  /**
   * True when the calibrated residual was a CREDIT larger than every named
   * cost line put together and was clamped to them. See
   * `clampOtherOpexCredit`: a sector can never be paid to run, so the credit
   * may cancel the inputs, labour, upkeep, compliance, financial and growth
   * bills, and not one anchor more. The stored `otherOpex` is the clamped
   * figure; the raw anchor-times-units product is on `otherOpexUncapped`.
   */
  otherOpexCreditCapped: boolean;
  otherOpexUncapped: number;
  /**
   * The DERIVED margin. Under plants `effectiveProfitMargin` is an OUTPUT of
   * the cost model, not an input to it — see `assemblePhysicalPnl`.
   */
  derivedMarginPct: number;
}

/**
 * Bound the calibration residual when it is a CREDIT.
 *
 * `solveOtherOpexPerUnit` keeps a negative residual on purpose: on the
 * calibration turn the named physical bills already exceed the margin
 * formula's total, and the negative residual is what makes the flip identity
 * hold. That residual is then stored PER UNIT and re-multiplied by
 * `producedUnits` every turn after. Nothing tied it to the bills it was solved
 * against, so once the unit count or the unit economics moved (a capacity
 * build, an auto-retool rebase, a nameplate restatement) the credit kept
 * scaling on its own and the sector booked profit far above its revenue.
 *
 * Measured live (2026-09-02, prod turn 571): one NPC rare-earth sector with
 * anchor -1201 anchor/unit and 161K units/turn carried an otherOpex line of
 * -1.74T JPY/day against 287M JPY/day of revenue. The corp booked income 500x
 * revenue, priced at 14x the next-largest corporation on the exchange, and the
 * Global Top 50 index fund bought 57% of its NAV into it.
 *
 * The invariant this enforces: a plant can never be paid to run. The residual
 * credit may cancel the inputs, labour, upkeep, compliance, financial and
 * growth bills it was calibrated against, and not one anchor more. Profit is
 * therefore bounded by revenue (plus the bounded policy stack) for every
 * sector, by construction, whatever the stored anchor says. A positive
 * residual (a charge) is never touched, and a credit smaller than the bills
 * is never touched either, so the calibration identity still holds on every
 * sector where it held honestly.
 */
export function clampOtherOpexCredit(args: {
  otherOpex: number;
  inputsCost: number;
  laborCost: number;
  financialLegs: number;
  upkeep: number;
  complianceCost: number;
  growthCost: number;
}): number {
  const { otherOpex, inputsCost, laborCost, financialLegs, upkeep, complianceCost, growthCost } =
    args;
  if (!Number.isFinite(otherOpex) || otherOpex >= 0) return otherOpex;
  const namedBills =
    Math.max(0, inputsCost) +
    Math.max(0, laborCost) +
    Math.max(0, financialLegs) +
    Math.max(0, upkeep) +
    Math.max(0, complianceCost) +
    Math.max(0, growthCost);
  const floor = Number.isFinite(namedBills) && namedBills > 0 ? -namedBills : 0;
  return otherOpex < floor ? floor : otherOpex;
}

/**
 * Assemble the lines into a profit, and DERIVE the margin.
 *
 * `derivedMarginPct = 100 × (1 − operatingCost / revenue)`.
 *
 * That denominator choice is deliberate: the old `effectiveMargin` satisfied
 * `grossMaintenance = revenue × (1 − margin/100)` and nothing else, so deriving
 * against `operatingCost` (the same scope) makes the derived value EXACTLY
 * equal to the old one on the calibration turn — every existing margin reader
 * keeps working and sees no step. Deriving against total profit instead would
 * have folded upkeep/growth/compliance into a number no reader expects to
 * contain them, producing a visible flip-day jump in a display field.
 *
 * At zero revenue the margin is 0 (no meaningful ratio) rather than −∞.
 */
export function assemblePhysicalPnl(args: {
  hourlyRevenue: number;
  inputsCost: number;
  laborCost: number;
  upkeep: number;
  complianceCost: number;
  otherOpex: number;
  financialLegs: number;
  growthCost: number;
  policyCredit: number;
}): PhysicalPnl {
  const { hourlyRevenue, inputsCost, laborCost, upkeep, complianceCost, financialLegs } = args;
  const { growthCost, policyCredit } = args;
  let { otherOpex } = args;
  const otherOpexUncapped = otherOpex;
  const clampedOtherOpex = clampOtherOpexCredit({
    otherOpex,
    inputsCost,
    laborCost,
    financialLegs,
    upkeep,
    complianceCost,
    growthCost,
  });
  const otherOpexCreditCapped = clampedOtherOpex !== otherOpex;
  otherOpex = clampedOtherOpex;
  // `policyCredit` sits inside operatingCost (as a credit) so the derived
  // margin keeps the same scope the old `effectiveMargin` had — the modifier
  // stack was part of that number, and margin readers expect it there.
  const operatingCost = inputsCost + laborCost + otherOpex + financialLegs - policyCredit;
  const totalCost = operatingCost + upkeep + complianceCost + growthCost;
  const profit = hourlyRevenue - totalCost;
  const derivedMarginPct =
    Number.isFinite(hourlyRevenue) && hourlyRevenue > 0
      ? Math.min(100, 100 * (1 - operatingCost / hourlyRevenue))
      : 0;
  return {
    inputsCost,
    laborCost,
    upkeep,
    complianceCost,
    otherOpex,
    financialLegs,
    growthCost,
    policyCredit,
    operatingCost,
    totalCost,
    profit,
    derivedMarginPct,
    otherOpexCreditCapped,
    otherOpexUncapped,
  };
}
