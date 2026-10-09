/**
 * Pure helpers for the field-office map: fills, pin placement, labels. Kept
 * out of the component so they are testable without a DOM.
 */

const LEFT = [59, 130, 246] as const; // #3b82f6
const RIGHT = [239, 68, 68] as const; // #ef4444
const EVEN = [42, 42, 61] as const; // BLEND.hairlineStrong
const VALUE = [34, 197, 94] as const; // BLEND.positive

function mix(a: readonly number[], b: readonly number[], t: number): string {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/**
 * Diverging fill for a PVI. Saturates at 30 points, with a square-root ramp so
 * the competitive band (within 10) still separates visibly.
 */
export function leanFill(pvi: number): string {
  if (!Number.isFinite(pvi) || Math.abs(pvi) < 0.5) return mix(EVEN, EVEN, 0);
  const t = Math.sqrt(Math.min(1, Math.abs(pvi) / 30));
  return mix(EVEN, pvi < 0 ? LEFT : RIGHT, 0.25 + 0.75 * t);
}

/** Sequential fill for the marginal value of a new office, relative to the best spot. */
export function valueFill(marginalPct: number, maxMarginalPct: number): string {
  if (!(maxMarginalPct > 0) || !(marginalPct > 0)) return mix(EVEN, EVEN, 0);
  const t = Math.sqrt(Math.min(1, marginalPct / maxMarginalPct));
  return mix(EVEN, VALUE, 0.15 + 0.85 * t);
}

/** "R+8.1", "D+30.3", "EVEN". US-style party letters are deliberately avoided: L/R. */
export function leanLabel(pvi: number): string {
  if (!Number.isFinite(pvi) || Math.abs(pvi) < 0.5) return "Even";
  return `${pvi < 0 ? "Left" : "Right"} +${Math.abs(pvi).toFixed(1)}`;
}

/**
 * Approximate visual centre of an SVG path: the centre of its bounding box.
 * Committed county paths are absolute M/L/Z polygons, so every number pair is
 * a vertex. Returns null for an empty path.
 */
export function pathCentre(path: string): { x: number; y: number } | null {
  const nums = path.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = Number(nums[i]);
    const y = Number(nums[i + 1]);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** Pin radius scaled to the viewBox so pins read the same on Rhode Island and Texas. */
export function pinRadius(viewBox: string): number {
  const parts = viewBox.split(/\s+/).map(Number);
  const span = Math.max(parts[2] || 0, parts[3] || 0);
  return span > 0 ? span * 0.012 : 1;
}

export function formatPct(n: number, digits = 2): string {
  return `+${n.toFixed(digits)}%`;
}
