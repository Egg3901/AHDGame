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
