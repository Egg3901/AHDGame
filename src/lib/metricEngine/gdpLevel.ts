/** Smallest positive GDP level (millions) — never let a region hit 0 and stick. */
const GDP_FLOOR = 0.001;

/**
 * Compound a region's GDP LEVEL by the per-turn equivalent of an ANNUAL growth
 * rate, using the exact form `(1 + r)^(1/n)` (design §5.5 — the naive `1 + r/n`
 * drifts ~0.05%/yr off the annual rate). `prevGdp` is in millions;
 * `annualGrowthPct` is the `gdpGrowth` metric value for the region this turn.
 * Non-finite/non-positive prev → floored; non-finite growth → treated as 0%.
 */
export function compoundGdpLevel(
  prevGdp: number,
  annualGrowthPct: number,
  turnsPerYear: number
): number {
  const base = Number.isFinite(prevGdp) && prevGdp > 0 ? prevGdp : GDP_FLOOR;
  const r = Number.isFinite(annualGrowthPct) ? annualGrowthPct : 0;
  const perTurnFactor = (1 + r / 100) ** (1 / turnsPerYear);
  return Math.max(GDP_FLOOR, base * perTurnFactor);
}

/**
 * EMA-smoothed national GDP for fragile consumers (debt-to-GDP, sovereign
 * default) so per-turn regional noise can't trip a default (design §5.4 / §6.1).
 * `inertia` weights the prior; missing/non-finite prior cold-starts to `current`.
 */
export function smoothNationalGdp(
  prev: number | undefined,
  current: number,
  inertia: number
): number {
  if (prev === undefined || !Number.isFinite(prev)) return current;
  return inertia * prev + (1 - inertia) * current;
}
