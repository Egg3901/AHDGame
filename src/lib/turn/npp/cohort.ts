/** Spread corporation state changes across turns to avoid supply cliffs. */
export const GLUT_STATE_CHANGE_STAGGER = 8;

/** Deterministic per-corporation turn slot. */
export function glutStaggerEligible(corpId: string, turn: number): boolean {
  const tail = parseInt(corpId.slice(-6), 16);
  const hash = Number.isFinite(tail) ? tail : 0;
  return (hash + turn) % GLUT_STATE_CHANGE_STAGGER === 0;
}

/**
 * Cohort slot multiplier for logistics during a critical freight shortage.
 * Freight is not tradeable, so a national shortfall cannot be answered from
 * abroad; a corporation gets this many of the GLUT_STATE_CHANGE_STAGGER slots
 * instead of one. Applies to logistics entry only.
 */
export const CRITICAL_LOGISTICS_COHORT_WIDENING = 3;

/** Widened deterministic slot: the ordinary slot plus the next widening-1 turns. */
export function criticalLogisticsStaggerEligible(corpId: string, turn: number): boolean {
  const tail = parseInt(corpId.slice(-6), 16);
  const hash = Number.isFinite(tail) ? tail : 0;
  return (hash + turn) % GLUT_STATE_CHANGE_STAGGER < CRITICAL_LOGISTICS_COHORT_WIDENING;
}
