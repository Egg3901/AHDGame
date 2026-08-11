export function applyBounds(value: number, [min, max]: [number, number]): number {
  return Math.max(min, Math.min(max, value));
}

export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/**
 * Cap a per-turn move to ±threshold around prev and log when it bites. A flagged
 * move signals a runaway driver; the cap keeps one bad node from destabilizing
 * the turn (spec P0 "Stability" / design §4.4 circuit-breakers).
 */
export function applyCircuitBreaker(
  prev: number,
  next: number,
  threshold: number,
  nodeId: string,
  stateId: string
): number {
  const delta = next - prev;
  if (Math.abs(delta) <= threshold) return next;
  console.warn(
    `[metricEngine] circuit-breaker: ${nodeId}@${stateId} moved ${delta.toFixed(2)} (>${threshold}); capped`
  );
  return prev + Math.sign(delta) * threshold;
}
