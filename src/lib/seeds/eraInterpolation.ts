/**
 * Era interpolation — the numeric spine of era continuity.
 *
 * Today every era-keyed table (`Record<EraId, T>`) is resolved ONCE from the
 * frozen seed preset and the world keeps that value forever. This module turns
 * those same tables into points on a curve over the LIVE in-game year: pick the
 * two anchor eras bracketing the year, lerp every number between them, and the
 * world slides along the curve as the clock advances.
 *
 * Design rules (see the era-continuity program, tracker project
 * `era-continuity`):
 *
 * - **Anchor identity.** At an anchor year the result is value-identical to
 *   the authored table. A world seeded at an anchor is a no-op on day one,
 *   and every existing per-era calibration test stays green unchanged.
 * - **Clamped, never extrapolated.** Outside [first anchor, last anchor] the
 *   nearest anchor holds. Extrapolating authored leans past the last anchor
 *   is how a ±5 axis gets exceeded.
 * - **Throw on structural mismatch.** Two anchors whose trees differ in shape
 *   (a bucket present in 1979 but not in 1953) are an authoring problem to
 *   surface, not a value to silently drop. Callers with a genuine identity
 *   change across eras handle it ABOVE this module.
 * - **Fresh values out, always.** Results are newly built objects even at
 *   t = 0/1 — several era tables share a mutable base object by reference
 *   (see `getEraPositions`), and handing that base out has bitten before.
 *
 * Gravity, not rails: this module moves BASELINES. Player effects are stored
 * as deltas on those baselines and must be re-applied downstream, never
 * recomputed here.
 */
import type { EraId } from "./presetSelector";

/** Calendar year each era bundle is authored against. */
export const ERA_ANCHOR_YEARS: Record<EraId, number> = {
  "1953": 1953,
  "1979": 1979,
  "1991": 1991,
  "1999": 1999,
  "2007": 2007,
  "2019": 2019,
  "2023": 2023,
};

/** All era ids in ascending anchor-year order. */
export const ERA_IDS_ASC: readonly EraId[] = [
  "1953",
  "1979",
  "1991",
  "1999",
  "2007",
  "2019",
  "2023",
];

/**
 * Every interpolation fallback taken since the last reset, as
 * `{label, reason}`. Module-level for the same reason `getPresetFallbacks()`
 * is: the useful artifact is the WHOLE list after a batch of independent
 * lookups, not a line buried next to each one.
 */
const interpolationFallbacks: Array<{ label: string; reason: string }> = [];

/**
 * Record that an era interpolation could not be performed and the caller
 * degraded to a discrete bundle.
 *
 * THE FALLBACK IS RECORDED, NOT SILENT. On the vote path a structural throw
 * cannot be allowed to propagate — `deriveCellsForState` is wrapped in a
 * `try/catch` that degrades to `null`, which would cost a whole state its
 * granular electorate on election night over an authoring mismatch. So the
 * caller catches and falls back, and this is what stops that from being
 * invisible: the gaps can be counted and fixed instead of quietly shaping
 * results.
 */
export function recordEraInterpolationFallback(label: string, reason: string): void {
  interpolationFallbacks.push({ label, reason });
}

/** Snapshot of the fallbacks recorded so far (most recent last). */
export function getEraInterpolationFallbacks(): ReadonlyArray<{ label: string; reason: string }> {
  return [...interpolationFallbacks];
}

/** Clear the record — call at the start of a run whose fallbacks you want to inspect. */
export function resetEraInterpolationFallbacks(): void {
  interpolationFallbacks.length = 0;
}

export interface EraBlend {
  /** Anchor era at or below the year (after clamping). */
  lo: EraId;
  /** Anchor era at or above the year. Equals `lo` exactly at an anchor/clamp. */
  hi: EraId;
  /** Blend fraction in [0, 1]: 0 = fully `lo`, 1 = fully `hi`. */
  t: number;
  /** The year after clamping to the available anchor range. */
  year: number;
}

/**
 * Resolve which two anchor eras bracket `year`, and how far between them it
 * sits. `available` restricts the anchor set — pass the keys a sparse table
 * actually has (e.g. a country authored only for 1953/1979/2019) and the blend
 * runs between its nearest REAL anchors instead of failing on the gaps.
 */
export function resolveEraBlend(year: number, available: readonly EraId[] = ERA_IDS_ASC): EraBlend {
  if (!Number.isFinite(year)) {
    throw new Error(`resolveEraBlend: year must be finite, got ${year}`);
  }
  const eras = ERA_IDS_ASC.filter((e) => available.includes(e));
  if (eras.length === 0) {
    throw new Error("resolveEraBlend: no available anchor eras");
  }
  const first = eras[0];
  const last = eras[eras.length - 1];
  if (year <= ERA_ANCHOR_YEARS[first]) {
    return { lo: first, hi: first, t: 0, year: ERA_ANCHOR_YEARS[first] };
  }
  if (year >= ERA_ANCHOR_YEARS[last]) {
    return { lo: last, hi: last, t: 0, year: ERA_ANCHOR_YEARS[last] };
  }
  for (let i = 1; i < eras.length; i++) {
    const hiYear = ERA_ANCHOR_YEARS[eras[i]];
    if (year <= hiYear) {
      const loYear = ERA_ANCHOR_YEARS[eras[i - 1]];
      if (year === hiYear) return { lo: eras[i], hi: eras[i], t: 0, year };
      return { lo: eras[i - 1], hi: eras[i], t: (year - loYear) / (hiYear - loYear), year };
    }
  }
  return { lo: last, hi: last, t: 0, year: ERA_ANCHOR_YEARS[last] };
}

/**
 * The era whose anchor year is closest at-or-below `year` (clamped to the
 * range). For consumers that genuinely need a DISCRETE era bundle off the live
 * clock — art tiers, era-keyed asset manifests — not for anything numeric,
 * which should blend via {@link resolveEraBlend}.
 */
export function eraIdForYear(year: number): EraId {
  const { lo } = resolveEraBlend(year);
  return lo;
}

/**
 * Structural lerp over a JSON-ish tree: numbers interpolate, equal
 * non-numeric primitives pass through, arrays go elementwise, objects go
 * key-by-key with the key sets required to match exactly. Anything else —
 * length mismatch, key mismatch, unequal strings, type divergence — throws
 * with the offending path.
 *
 * Always returns freshly built containers, even at t = 0 or 1.
 */
export function lerpNumericTree<T>(lo: T, hi: T, t: number, path = "$"): T {
  if (typeof lo === "number" && typeof hi === "number") {
    return (lo + (hi - lo) * t) as T;
  }
  if (lo === null || hi === null || typeof lo !== "object" || typeof hi !== "object") {
    // Primitive (or null) leaves must agree — a string that differs between
    // anchors is an identity change, which is a caller-level decision.
    if (Object.is(lo, hi)) return lo;
    throw new Error(
      `lerpNumericTree: non-numeric leaves differ at ${path}: ${String(lo)} vs ${String(hi)}`
    );
  }
  if (Array.isArray(lo) || Array.isArray(hi)) {
    if (!Array.isArray(lo) || !Array.isArray(hi) || lo.length !== hi.length) {
      throw new Error(`lerpNumericTree: array shape mismatch at ${path}`);
    }
    return lo.map((v, i) => lerpNumericTree(v, hi[i], t, `${path}[${i}]`)) as T;
  }
  const loKeys = Object.keys(lo as Record<string, unknown>);
  const hiKeys = Object.keys(hi as Record<string, unknown>);
  if (loKeys.length !== hiKeys.length || loKeys.some((k) => !(k in (hi as object)))) {
    const missing = [
      ...loKeys.filter((k) => !(k in (hi as object))).map((k) => `-${k}`),
      ...hiKeys.filter((k) => !(k in (lo as object))).map((k) => `+${k}`),
    ];
    throw new Error(`lerpNumericTree: key-set mismatch at ${path}: ${missing.join(", ")}`);
  }
  const out: Record<string, unknown> = {};
  for (const k of loKeys) {
    out[k] = lerpNumericTree(
      (lo as Record<string, unknown>)[k],
      (hi as Record<string, unknown>)[k],
      t,
      `${path}.${k}`
    );
  }
  return out as T;
}

/**
 * Interpolate an era-keyed bundle table at a live year. Missing eras are
 * skipped (the blend runs between the nearest anchors the table actually has),
 * so sparsely authored tables degrade to their real coverage instead of
 * throwing — matching how `selectPresetBundle` treats deliberate aliases.
 *
 * At an anchor year this returns a fresh deep copy that is value-identical to
 * the authored bundle (the anchor-identity invariant).
 */
export function interpolateEraBundles<T>(
  bundles: Partial<Record<EraId, T>>,
  year: number,
  label = "eraInterpolation"
): T {
  const available = ERA_IDS_ASC.filter((e) => bundles[e] != null);
  if (available.length === 0) {
    throw new Error(`${label}: no era bundles to interpolate`);
  }
  const { lo, hi, t } = resolveEraBlend(year, available);
  try {
    return lerpNumericTree(bundles[lo] as T, bundles[hi] as T, t);
  } catch (err) {
    throw new Error(`${label}: ${lo}↔${hi} @ ${year}: ${(err as Error).message}`);
  }
}

/**
 * Renormalise a record of non-negative shares to sum to `total` (default 1).
 * Interpolating two normalised share vectors keeps the sum only when both
 * anchors carry the same key set and were themselves exactly normalised —
 * authored tables round. Run this per dimension after interpolation so the
 * IPF rake downstream keeps valid marginals. A zero-sum vector is returned
 * unchanged (there is nothing meaningful to scale).
 */
export function renormalizeShares<K extends string>(
  shares: Record<K, number>,
  total = 1
): Record<K, number> {
  const keys = Object.keys(shares) as K[];
  let sum = 0;
  for (const k of keys) {
    const v = shares[k];
    if (!Number.isFinite(v) || v < 0) {
      throw new Error(`renormalizeShares: invalid share ${String(k)}=${v}`);
    }
    sum += v;
  }
  if (sum === 0) return { ...shares };
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = (shares[k] / sum) * total;
  return out;
}
