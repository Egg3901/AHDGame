/**
 * Labour market telemetry (phase 1 of the labour market build).
 *
 * The corporate engine has always sized a sector's headcount from its revenue
 * (`calculateWorkers`) and never once checked that headcount against the number
 * of people who actually live in the state. Supply and demand were computed by
 * two systems that had no edge between them: `economic.laborForce` comes out of
 * the metric engine, sector `workers` comes out of the corporation turn, and
 * nothing ever compared them.
 *
 * The result is measurable and large. On the live world a single Arizona
 * extraction sector carried 47,996,752 workers against a state labour force of
 * 314,613, and state unemployment sat unmoved at 15% the whole time.
 *
 * This module is deliberately INERT. It computes the comparison and nothing
 * else: no rationing, no wage response, no unemployment coupling. Phase 1 exists
 * to put a real number on how tight each labour market is before any mechanic is
 * priced off it, because the tuning question ("how many markets are actually
 * oversubscribed, and by how much") cannot be answered from a codebase that has
 * never measured it. Phases 2 and 3 add rationing and the scarcity wage premium
 * on top of these fields.
 */

/**
 * Per-state labour demand: the sum of every sector's revenue-implied headcount.
 *
 * Accumulated during the corporation turn's sector loop, one entry per state,
 * in the same "collect during the pure loop, consume after" pattern as
 * `wageIndexByState`. Deliberately NOT gated on `labour.wagesEnabled`: how many
 * jobs the corporate sector wants is a headcount fact that exists whether or not
 * the wage system is switched on, and gating it would leave the telemetry blank
 * in exactly the worlds most likely to need it.
 */
export type LabourDemandByState = Map<string, number>;

export function makeLabourDemandByState(): LabourDemandByState {
  return new Map<string, number>();
}

/**
 * Add one sector's desired headcount to its state's running demand total.
 *
 * Negative and non-finite inputs floor to 0 so a corrupt `workers` value cannot
 * drag a whole state's demand negative, which would read as slack where there
 * is none.
 */
export function accumulateLabourDemand(
  demandByState: LabourDemandByState,
  stateId: string,
  workers: number
): void {
  const w = Number.isFinite(workers) ? Math.max(0, workers) : 0;
  demandByState.set(stateId, (demandByState.get(stateId) ?? 0) + w);
}

/**
 * Labour market tightness: desired corporate headcount over available civilian
 * labour force.
 *
 * 1.0 means the corporate sector wants exactly as many workers as the state has.
 * Below 1 the market has slack. Above 1 it is oversubscribed, and the excess is
 * headcount that could never be staffed by real people.
 *
 * Returns `undefined` rather than a number when supply is missing or not
 * positive. A state with no `economic.laborForce` reading (cold start, a country
 * the metric engine does not cover yet) has an UNKNOWN tightness, not an
 * infinite one, and writing Infinity or a sentinel 0 would poison the very
 * distribution phase 1 exists to measure. Callers skip the write instead.
 */
export function computeLabourTightness(
  demandWorkers: number,
  labourSupply: number | undefined | null
): number | undefined {
  if (typeof labourSupply !== "number" || !Number.isFinite(labourSupply) || labourSupply <= 0) {
    return undefined;
  }
  if (!Number.isFinite(demandWorkers) || demandWorkers < 0) return undefined;
  return demandWorkers / labourSupply;
}

/**
 * Rounding for the persisted tightness reading.
 *
 * Three decimals keeps slack markets legible (0.412 reads differently from
 * 0.418) while leaving oversubscribed ones unbounded, because the whole point of
 * the measurement is that some states read 200 and clamping the top of the range
 * would hide the finding.
 */
export function roundTightness(tightness: number): number {
  return Math.round(tightness * 1000) / 1000;
}

/**
 * Staffing fill rate implied by a state's labour market tightness (phase 2).
 *
 * When a state's corporate sectors collectively want more workers than the
 * state has, every sector fills the same PRO RATA share of what it asked for.
 * Tightness 2.0 means each sector staffs half its desired headcount; tightness
 * 200 means each staffs one two-hundredth.
 *
 * Slack markets return exactly 1. So does an unknown tightness, so a state the
 * metric engine has no labour force reading for behaves exactly as it does
 * today rather than being silently throttled on missing data.
 *
 * Pro rata rather than first-come: sectors are processed in an arbitrary order
 * inside the turn, so any priority rule would hand a windfall to whichever
 * sector happened to be iterated first, and that order is not something a
 * player can see or act on. Bidding for priority is phase 3, once wages can
 * actually respond to scarcity.
 */
export function staffingFactorFromTightness(tightness: number | undefined | null): number {
  if (typeof tightness !== "number" || !Number.isFinite(tightness) || tightness <= 1) return 1;
  return 1 / tightness;
}

/**
 * Headcount a sector can actually staff, given what it wanted and what its state
 * can supply.
 *
 * Floors at 1 for any sector that wanted at least one worker: a rationed sector
 * is understaffed, not abolished, and a 0 here would divide-by-zero the
 * `wagePerWorker` derivation downstream.
 */
export function filledWorkers(desiredWorkers: number, staffingFactor: number): number {
  if (!Number.isFinite(desiredWorkers) || desiredWorkers <= 0) return 0;
  return Math.max(1, Math.round(desiredWorkers * staffingFactor));
}
