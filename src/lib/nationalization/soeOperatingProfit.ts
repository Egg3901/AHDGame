/**
 * The operating profit a state-owned sector ACTUALLY earned, in the sector's
 * stored currency, on the daily basis `revenue` and `realizedRevenue` use.
 *
 * ─── Why this exists (ticket 1072) ──────────────────────────────────────────
 *
 * The National Corporation page used to compute a holding's operating profit as
 *
 *     profit = revenue x max(0, effectiveProfitMargin) / 100
 *
 * Every term in that line is wrong for a plant that is not running, and the
 * three errors compound in the same direction:
 *
 *  1. `revenue` is the NAMEPLATE (capacity x mix price). Mothballing or idling
 *     a plant drives `realizedRevenue` to 0 and leaves the nameplate exactly
 *     where it was, so the basis never notices the plant went cold.
 *  2. `effectiveProfitMargin` is not an achieved margin for such a sector. The
 *     turn processor is explicit about it: a sector with no revenue this turn
 *     "has no ratio to derive from", so it keeps reporting the modifier stack,
 *     which is what its margin WOULD be if it ran. That counterfactual is fine
 *     as a hint and is not a number to multiply money by.
 *  3. `Math.max(0, ...)` floored the margin, so a running sector losing money
 *     reported exactly 0 and could never look worse than a cold one.
 *
 * Together they inverted the incentive the mothball button exists to create.
 * On prod (turn 243) the East German Manufacturing Enterprise had five of six
 * plants cold, producing nothing and realizing nothing, and the page reported
 * +4,775,875 per day of operating profit against an engine-booked income of
 * -68,139 per turn. The reporter read it correctly and said so: "Basically
 * anyone could use this to make huge profits."
 *
 * ─── What replaces it ───────────────────────────────────────────────────────
 *
 * In order of preference:
 *
 *  1. `sector.plantsPnl.profit`, the figure the turn booked, when the row has
 *     it. This is the only source that carries upkeep and compliance, which sit
 *     outside the margin's scope and inside the profit.
 *  2. Realized revenue x the engine margin, unfloored, minus the upkeep a cold
 *     plant still pays. A sector that realized nothing therefore reports the
 *     upkeep it is burning, which is a loss, which is the truth.
 *
 * The upkeep leg mirrors `plantsUpkeepCost` in `sectorTurn`: a mothballed plant
 * pays {@link MOTHBALL_UPKEEP_FRACTION} of running maintenance on its whole
 * capacity, an idle-but-live plant pays {@link IDLE_UPKEEP_FRACTION} on the
 * share of capacity its owner chose to leave idle. It is priced off the held
 * `plantsUpkeepMarginBasisAnchor` for the same reason the turn does: a fixed
 * cost must not grow as the sector's margin falls.
 *
 * Below plants nothing here changes behaviour. There is no mothball button,
 * `realizedRevenue` tracks `revenue`, and the margin is last turn's modifier
 * stack for every sector alike.
 */
import { IDLE_UPKEEP_FRACTION, MOTHBALL_UPKEEP_FRACTION } from "@/lib/constants/capacityEconomy";

/**
 * The persisted booked P&L (ticket 1122, `CorporateSector.plantsPnl`), read
 * structurally so this module does not depend on that field having landed yet.
 * Absent or non-finite falls through to the realized-revenue path below.
 */
interface BookedPnlShape {
  profit?: unknown;
}

/** The sector fields this basis reads. Structural so partial projections fit. */
export interface SoeOperatingProfitInput {
  revenue?: number | null;
  realizedRevenue?: number | null;
  profitMargin?: number | null;
  effectiveProfitMargin?: number | null;
  mothballed?: boolean | null;
  capitalUtilization?: number | null;
  throughputFactor?: number | null;
  plantsUpkeepMarginBasisAnchor?: number | null;
  plantsPnl?: BookedPnlShape | null;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * The share of capacity the OWNER chose to leave idle, [0, 1].
 *
 * Mirrors `ownerIdleUnits` in the turn processor and the same expression in
 * `estimateNationalizedOperatingIncome`: capacity stopped by an input shortage
 * is not an over-build, so `throughputFactor` divides out of the idle share.
 * A sector with no persisted utilization is treated as fully utilized, because
 * a missing field must never invent a cost.
 */
function ownerIdleShare(sector: SoeOperatingProfitInput): number {
  const utilization = finite(sector.capitalUtilization) ? sector.capitalUtilization : 1;
  const involuntary = finite(sector.throughputFactor) ? sector.throughputFactor : 1;
  if (!(involuntary > 0)) return 0;
  return Math.max(0, 1 - Math.min(1, utilization / involuntary));
}

/**
 * Daily upkeep on capacity that is not producing, in the sector's stored
 * currency. Under plants `revenue` is capacity x mix price, so
 * `revenue x idleShare` is the nominal value of the units standing still and
 * the turn's per-unit upkeep rate applies to it directly.
 */
export function soeIdleUpkeepCost(sector: SoeOperatingProfitInput, plantsEnabled: boolean): number {
  if (!plantsEnabled) return 0;
  const nameplate = finite(sector.revenue) ? Math.max(0, sector.revenue) : 0;
  if (!(nameplate > 0)) return 0;
  const basis = finite(sector.plantsUpkeepMarginBasisAnchor)
    ? Math.max(0, Math.min(1, sector.plantsUpkeepMarginBasisAnchor))
    : Math.max(0, 1 - (finite(sector.profitMargin) ? sector.profitMargin : 0) / 100);
  if (sector.mothballed === true) {
    return nameplate * basis * MOTHBALL_UPKEEP_FRACTION;
  }
  return nameplate * ownerIdleShare(sector) * basis * IDLE_UPKEEP_FRACTION;
}

/**
 * The revenue a sector's profit may be computed against.
 *
 * Realized, never nameplate, and 0 for a mothballed plant even if a stale
 * `realizedRevenue` survives on the row: mothballing is the one state where the
 * engine is unconditional that the sector "earns exactly 0".
 */
export function soeRealizedRevenue(
  sector: SoeOperatingProfitInput,
  plantsEnabled: boolean
): number {
  if (plantsEnabled && sector.mothballed === true) return 0;
  if (finite(sector.realizedRevenue)) return Math.max(0, sector.realizedRevenue);
  return finite(sector.revenue) ? Math.max(0, sector.revenue) : 0;
}

/**
 * Operating profit for one state-owned holding, daily, in the sector's stored
 * currency. SIGNED: a sector that loses money returns a negative number, which
 * is the whole point of the change.
 *
 * `fallbackMarginPct` is the margin to use when the row carries no engine
 * figure yet (a sector that has never processed a turn); callers pass the
 * modifier-stack margin they already computed.
 */
export function soeSectorOperatingProfit(
  sector: SoeOperatingProfitInput,
  plantsEnabled: boolean,
  fallbackMarginPct: number
): number {
  // 1. The booked P&L, when the turn has written one. Carries upkeep and
  //    compliance, so no separate upkeep leg is added on top of it.
  const booked = sector.plantsPnl?.profit;
  if (plantsEnabled && finite(booked)) return booked;

  // 2. Realized revenue at the engine's margin, unfloored, less idle upkeep.
  const marginPct = finite(sector.effectiveProfitMargin)
    ? sector.effectiveProfitMargin
    : fallbackMarginPct;
  const realized = soeRealizedRevenue(sector, plantsEnabled);
  return (realized * marginPct) / 100 - soeIdleUpkeepCost(sector, plantsEnabled);
}
