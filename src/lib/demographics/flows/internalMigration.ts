import type { AgeSexVector } from "../cohortVector";
import { totalPopulation } from "../cohortVector";

export interface RegionPullMetrics {
  gdpGrowth: number; // %
  unemployment: number; // %
  medianIncome: number; // currency
  costOfLiving: number; // 0-100 index
  labourTightness?: number; // desired workers / civilian labour force
  labourWageIndex?: number; // 1 = baseline wage
}

// Low weights (design §4.2: "low-weighted + clamped"). Attractiveness is a small
// dimensionless score; only its DEVIATION from the country mean drives flow.
const W_GDP = 0.3;
const W_UNEMP = 0.2;
const W_INCOME = 0.04; // per % above/below the country-average income
const W_COL = 0.05; // per point of cost-of-living above the neutral 50
const W_LABOUR_SHORTAGE = 1;
const ATTRACT_CLAMP = 10;

/**
 * Economic-pull attractiveness of a region (design §4.2): higher growth and
 * income pull migrants in; unemployment and cost of living push them out. Income
 * is measured RELATIVE to the country average (a region is attractive only if it
 * pays better than its peers). Clamped to ±ATTRACT_CLAMP so one outlier can't
 * dominate.
 */
export function regionAttractiveness(m: RegionPullMetrics, countryAvgMedianIncome: number): number {
  const incomeRelPct =
    countryAvgMedianIncome > 0
      ? ((m.medianIncome - countryAvgMedianIncome) / countryAvgMedianIncome) * 100
      : 0;
  const shortage =
    typeof m.labourTightness === "number" &&
    Number.isFinite(m.labourTightness) &&
    m.labourTightness > 1
      ? 1 - 1 / m.labourTightness
      : 0;
  const wage =
    typeof m.labourWageIndex === "number" && Number.isFinite(m.labourWageIndex)
      ? Math.max(0.5, Math.min(1.5, m.labourWageIndex))
      : 1;
  const raw =
    W_GDP * m.gdpGrowth -
    W_UNEMP * m.unemployment +
    W_INCOME * incomeRelPct -
    W_COL * (m.costOfLiving - 50) +
    W_LABOUR_SHORTAGE * shortage * wage;
  return Math.max(-ATTRACT_CLAMP, Math.min(ATTRACT_CLAMP, raw));
}

// Per-turn share of country population that reallocates per unit of attractiveness
// deviation. Because the net target scales with COUNTRY population (not the
// receiving region's), a small attractive state used to balloon — a 1-point
// attractiveness edge could add several %/yr, flipping House seats after a single
// game-year instead of over a realistic decade. Lowered so cross-state divergence
// stays ~1%/yr and decennial reapportionment moves a realistic handful of seats.
const INTERNAL_MIGRATION_SENSITIVITY = 0.00004;

/**
 * Zero-sum internal net migration targets (design §4.2 / N1). `net_r ∝ (A_r − Ā)`,
 * so `Σ net_r = 0` by construction (Ā is the simple mean). Positive = net inflow.
 * Magnitude scales with the country population and a small sensitivity, per turn.
 * A single-region country gets 0 (no peers to trade with).
 */
export function computeInternalNetTargets(
  attractByRegion: Map<string, number>,
  populationByRegion: Map<string, number>,
  turnsPerYear: number
): Map<string, number> {
  const ids = [...attractByRegion.keys()];
  const out = new Map<string, number>();
  if (ids.length < 2) {
    for (const id of ids) out.set(id, 0);
    return out;
  }
  const mean = ids.reduce((s, id) => s + (attractByRegion.get(id) ?? 0), 0) / ids.length;
  const countryPop = ids.reduce((s, id) => s + (populationByRegion.get(id) ?? 0), 0);
  const scale = (INTERNAL_MIGRATION_SENSITIVITY * countryPop) / turnsPerYear;
  let raw = ids.map((id) => ({ id, net: ((attractByRegion.get(id) ?? 0) - mean) * scale }));
  // Re-zero any floating residual so Σ is exactly 0.
  const residual = raw.reduce((s, r) => s + r.net, 0) / ids.length;
  raw = raw.map((r) => ({ id: r.id, net: r.net - residual }));
  for (const r of raw) out.set(r.id, r.net);
  return out;
}

const MAX_FIXPOINT_PASSES = 8;

/**
 * Scale a profile to `amount` and apply it (signed) to a vector with per-cell
 * non-negativity clamping on removal (F-B). Returns the new vector + the amount
 * actually applied (|applied| < |amount| when cells clamp on removal).
 */
function applyProfile(
  vector: AgeSexVector,
  amount: number,
  profile: AgeSexVector
): { vector: AgeSexVector; applied: number } {
  const out: AgeSexVector = { male: vector.male.slice(), female: vector.female.slice() };
  let applied = 0;
  for (const sex of ["male", "female"] as const) {
    for (let a = 0; a <= 100; a++) {
      const delta = amount * (profile[sex][a] ?? 0);
      const pop = out[sex][a];
      const clamped = delta < 0 ? Math.max(delta, -pop) : delta; // F-B: never below 0
      out[sex][a] = pop + clamped;
      applied += clamped;
    }
  }
  return { vector: out, applied };
}

/**
 * Apply zero-sum internal migration with the §4.4 guardrails. Outflows shed by
 * the migrant profile (per-cell F-B clamp + circuit-breaker cap); the pool that
 * is actually shed is matched into inflow regions (cap-limited), with capped
 * overflow redistributed via a bounded fixpoint, and any unplaceable remainder
 * returned to the outflow regions so `Σ == 0` exactly. `maxChangeFraction` caps a
 * region's net change per turn (circuit-breaker); each cap event increments
 * `circuitBreakerTrips`.
 */
export function applyInternalMigration(
  vectors: Map<string, AgeSexVector>,
  netTargets: Map<string, number>,
  profile: AgeSexVector,
  maxChangeFraction: number
): { vectors: Map<string, AgeSexVector>; circuitBreakerTrips: number } {
  const result = new Map<string, AgeSexVector>();
  for (const [id, v] of vectors) result.set(id, { male: v.male.slice(), female: v.female.slice() });
  let trips = 0;

  // Anti-depopulation sparsity damping: OUT-migration is full at/above the
  // country-average population and ramps DOWN linearly below it (the smaller the
  // region, the stickier), so a shrinking region sheds proportionally less and
  // asymptotically floors instead of emptying. A realistic proxy for the
  // cost-of-living-falls feedback until P1c wires the real loop. Only OUTFLOW is
  // damped — attractive regions still grow normally.
  const meanPop =
    [...vectors.values()].reduce((s, v) => s + totalPopulation(v), 0) / Math.max(1, vectors.size);
  const sparsityDamp = (regionPop: number) =>
    meanPop > 0 ? Math.max(0, Math.min(1, regionPop / meanPop)) : 1;

  // Circuit-breaker cap per region; split into outflow / inflow desires. Outflow
  // is sparsity-damped so a below-average region sheds proportionally less.
  const outflow: Array<{ id: string; want: number }> = [];
  const inflow: Array<{ id: string; want: number; room: number; got: number }> = [];
  for (const [id, net] of netTargets) {
    const regionPop = totalPopulation(vectors.get(id)!);
    const regionCap = maxChangeFraction * regionPop;
    const capped = Math.max(-regionCap, Math.min(regionCap, net));
    if (capped !== net) trips++;
    if (capped < 0) outflow.push({ id, want: -capped * sparsityDamp(regionPop) });
    else if (capped > 0) inflow.push({ id, want: capped, room: regionCap, got: 0 });
  }

  // 1. Apply outflows (F-B clamp inside applyProfile); pool the actual shed.
  let pool = 0;
  for (const o of outflow) {
    const { vector, applied } = applyProfile(result.get(o.id)!, -o.want, profile);
    result.set(o.id, vector);
    pool += -applied; // applied is negative; pool is positive total shed
  }

  // 2. Distribute the pool into inflow regions; fixpoint over capped overflow.
  let pass = 0;
  while (pool > 1e-6 && pass < MAX_FIXPOINT_PASSES) {
    const open = inflow.filter((i) => i.room - i.got > 1e-6);
    if (open.length === 0) break;
    const wantSum = open.reduce((s, i) => s + i.want, 0) || 1;
    let placedThisPass = 0;
    for (const i of open) {
      const share = (i.want / wantSum) * pool;
      const room = i.room - i.got;
      const give = Math.min(share, room);
      if (give <= 0) continue;
      const { vector, applied } = applyProfile(result.get(i.id)!, give, profile);
      result.set(i.id, vector);
      i.got += applied;
      placedThisPass += applied;
    }
    pool -= placedThisPass;
    if (placedThisPass <= 1e-6) break; // no progress → fallback below
    pass++;
  }

  // 3. Fallback: any unplaceable pool is returned to the outflow regions
  //    proportionally (add back) so Σ == 0 exactly even when caps bite.
  if (pool > 1e-6 && outflow.length > 0) {
    const wantSum = outflow.reduce((s, o) => s + o.want, 0) || 1;
    for (const o of outflow) {
      const back = (o.want / wantSum) * pool;
      const { vector } = applyProfile(result.get(o.id)!, back, profile);
      result.set(o.id, vector);
    }
  }

  return { vectors: result, circuitBreakerTrips: trips };
}
