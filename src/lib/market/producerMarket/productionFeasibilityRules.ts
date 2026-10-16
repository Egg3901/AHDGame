/**
 * Bounded production planning, before any order moves cash. The physical
 * constraints have a feasible zero opening and each activity is bounded 0..1.
 * A bounded-variable simplex keeps one row per commodity, rather than adding
 * one dense row per plant just to enforce its nameplate ceiling.
 */
export function feasibleProduction(input: {
  activities: readonly { id: string; value: number }[];
  constraints: readonly { available: number; coefficients: readonly number[] }[];
  maximumPivots?: number;
}): number[] {
  const n = input.activities.length;
  const m = input.constraints.length;
  const width = n + m;
  const ids = new Set<string>();
  for (const a of input.activities) {
    if (!a.id || ids.has(a.id) || !Number.isFinite(a.value) || a.value < 0)
      throw new Error("Invalid production activity");
    ids.add(a.id);
  }
  const rows = input.constraints.map((constraint, i) => {
    if (
      !Number.isFinite(constraint.available) ||
      constraint.available < 0 ||
      constraint.coefficients.length !== n ||
      constraint.coefficients.some((v) => !Number.isFinite(v))
    )
      throw new Error("Invalid production resource constraint");
    const scale = Math.max(1e-12, ...constraint.coefficients.map(Math.abs));
    const row = new Float64Array(width);
    for (let j = 0; j < n; j++) row[j] = constraint.coefficients[j] / scale;
    row[n + i] = 1;
    return { row, value: constraint.available / scale };
  });
  const coefficients = rows.map((r) => r.row);
  const values = rows.map((r) => r.value);
  const basic = rows.map((_, i) => n + i);
  const isBasic = new Uint8Array(width);
  for (const j of basic) isBasic[j] = 1;
  const nonbasic = new Float64Array(width);
  const reduced = new Float64Array(width);
  const objectiveScale = Math.max(1, ...input.activities.map((a) => a.value));
  for (let j = 0; j < n; j++) reduced[j] = input.activities[j].value / objectiveScale;
  const tolerance = 1e-10;
  const limit = input.maximumPivots ?? Math.max(1024, 10 * (n + m));
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid production pivot limit");
  const upper = (j: number) => (j < n ? 1 : Infinity);
  for (let pivot = 0; pivot < limit; pivot++) {
    // Prefer a strong improving column; use stable activity order for ties.
    let entering = -1;
    let direction = 1;
    let improvement = tolerance;
    for (let j = 0; j < width; j++) {
      if (isBasic[j]) continue;
      const d = nonbasic[j] === 0 ? 1 : -1;
      if (reduced[j] * d > improvement) {
        entering = j;
        direction = d;
        improvement = reduced[j] * d;
      }
    }
    if (entering < 0) {
      const result = Array.from(nonbasic.slice(0, n));
      for (let i = 0; i < m; i++) if (basic[i] < n) result[basic[i]] = values[i];
      for (let j = 0; j < n; j++) {
        if (!Number.isFinite(result[j]) || result[j] < -1e-7 || result[j] > 1 + 1e-7)
          throw new Error("Invalid feasible production bound");
        result[j] = Math.max(0, Math.min(1, result[j]));
      }
      for (const constraint of input.constraints) {
        const used = constraint.coefficients.reduce((sum, value, j) => sum + value * result[j], 0);
        const scale = Math.max(
          1,
          constraint.available,
          constraint.coefficients.reduce((sum, v) => sum + Math.abs(v), 0)
        );
        if (used > constraint.available + scale * tolerance * 10)
          throw new Error(
            `Production resource constraint did not reconcile: used=${used}, available=${constraint.available}, tolerance=${scale * tolerance * 10}`
          );
      }
      return result;
    }
    // A ratio tie must be exact: choosing a larger step, even within an
    // absolute epsilon, can overdraw a scarce input after row rescaling.
    let step = upper(entering);
    let leaving = -1;
    for (let i = 0; i < m; i++) {
      const movement = coefficients[i][entering] * direction;
      const available =
        movement > tolerance
          ? values[i] / movement
          : movement < -tolerance
            ? (upper(basic[i]) - values[i]) / -movement
            : Infinity;
      if (available < step || (available === step && (leaving < 0 || basic[i] < basic[leaving]))) {
        step = Math.max(0, available);
        leaving = i;
      }
    }
    if (!Number.isFinite(step)) throw new Error("Unbounded production activity");
    const enteringValue = nonbasic[entering] + direction * step;
    for (let i = 0; i < m; i++) values[i] -= coefficients[i][entering] * direction * step;
    if (leaving < 0) {
      nonbasic[entering] = enteringValue;
      continue;
    }
    const oldBasic = basic[leaving];
    nonbasic[oldBasic] = values[leaving] < 0.5 * upper(oldBasic) ? 0 : upper(oldBasic);
    // Slack variables have no finite upper bound, so a leaving slack is zero.
    if (oldBasic >= n) nonbasic[oldBasic] = 0;
    const pivotValue = coefficients[leaving][entering];
    for (let j = 0; j < width; j++) coefficients[leaving][j] /= pivotValue;
    for (let i = 0; i < m; i++) {
      if (i === leaving) continue;
      const factor = coefficients[i][entering];
      if (Math.abs(factor) < 1e-15) continue;
      for (let j = 0; j < width; j++) coefficients[i][j] -= factor * coefficients[leaving][j];
    }
    const cost = reduced[entering];
    for (let j = 0; j < width; j++) reduced[j] -= cost * coefficients[leaving][j];
    values[leaving] = enteringValue;
    nonbasic[entering] = 0;
    isBasic[oldBasic] = 0;
    isBasic[entering] = 1;
    basic[leaving] = entering;
  }
  throw new Error("Production feasibility did not converge");
}
