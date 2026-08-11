import type { DistrictSquares } from "@/lib/db/types/congressionalDistrict";
import type { Pool } from "./pools";

/** Display colors shared across the redistricting UI. */
export const POOL_COLORS: Record<Pool, string> = {
  left: "#3B82F6",
  grey: "#9CA3AF",
  right: "#EF4444",
};

/**
 * Lean-category thresholds on netLean (= right − left), tuned in one place.
 * |lean| >= SAFE ⇒ "safe"; SAFE > |lean| >= LEAN ⇒ "lean"; otherwise competitive.
 */
export const LEAN_SAFE_THRESHOLD = 8;
export const LEAN_TILT_THRESHOLD = 3;

/** 16 cells in display order: lefts, then greys, then rights. */
export function buildSquareCells(squares: DistrictSquares): Pool[] {
  // Clamp to a safe count: a malformed square (negative or non-integer) would
  // otherwise throw a RangeError in `new Array(...)` and crash the editor render.
  const count = (v: number) => Math.max(0, Math.floor(Number.isFinite(v) ? v : 0));
  return [
    ...new Array(count(squares.left)).fill("left" as Pool),
    ...new Array(count(squares.grey)).fill("grey" as Pool),
    ...new Array(count(squares.right)).fill("right" as Pool),
  ];
}

export function districtLeanLabel(netLean: number): {
  side: "Left" | "Right" | "Even";
  magnitude: number;
  text: string;
} {
  if (netLean === 0) return { side: "Even", magnitude: 0, text: "Even" };
  const side = netLean < 0 ? "Left" : "Right";
  const magnitude = Math.abs(netLean);
  return { side, magnitude, text: `${side} +${magnitude}` };
}

/**
 * A compact directional indicator for a district's lean, e.g. "← +3", "→ +2",
 * or "Even", with the pool color of the dominant side.
 */
export function netLeanIndicator(netLean: number): { text: string; color: string } {
  if (netLean === 0) return { text: "Even", color: POOL_COLORS.grey };
  if (netLean < 0) return { text: `← +${Math.abs(netLean)}`, color: POOL_COLORS.left };
  return { text: `→ +${netLean}`, color: POOL_COLORS.right };
}

export type LeanCategory = "safeLeft" | "leanLeft" | "competitive" | "leanRight" | "safeRight";

/** The five categories in left→right display order. */
export const LEAN_CATEGORIES: LeanCategory[] = [
  "safeLeft",
  "leanLeft",
  "competitive",
  "leanRight",
  "safeRight",
];

export const LEAN_CATEGORY_META: Record<LeanCategory, { label: string; color: string }> = {
  safeLeft: { label: "Safe Left", color: "#1D4ED8" },
  leanLeft: { label: "Lean Left", color: "#60A5FA" },
  competitive: { label: "Competitive", color: POOL_COLORS.grey },
  leanRight: { label: "Lean Right", color: "#F87171" },
  safeRight: { label: "Safe Right", color: "#B91C1C" },
};

/** Bucket a district by its netLean using the shared thresholds. */
export function categorizeDistrict(netLean: number): LeanCategory {
  if (netLean <= -LEAN_SAFE_THRESHOLD) return "safeLeft";
  if (netLean <= -LEAN_TILT_THRESHOLD) return "leanLeft";
  if (netLean < LEAN_TILT_THRESHOLD) return "competitive";
  if (netLean < LEAN_SAFE_THRESHOLD) return "leanRight";
  return "safeRight";
}

export interface CompositionSummary {
  total: number;
  counts: Record<LeanCategory, number>;
  /** Percentage (0..100) of districts in each category. */
  percents: Record<LeanCategory, number>;
}

/** Count districts per lean category from their squares. */
export function summarizeComposition(districts: DistrictSquares[]): CompositionSummary {
  const counts: Record<LeanCategory, number> = {
    safeLeft: 0,
    leanLeft: 0,
    competitive: 0,
    leanRight: 0,
    safeRight: 0,
  };
  for (const d of districts) {
    counts[categorizeDistrict(d.right - d.left)] += 1;
  }
  const total = districts.length;
  const percents: Record<LeanCategory, number> = {
    safeLeft: 0,
    leanLeft: 0,
    competitive: 0,
    leanRight: 0,
    safeRight: 0,
  };
  if (total > 0) {
    for (const c of LEAN_CATEGORIES) percents[c] = (counts[c] / total) * 100;
  }
  return { total, counts, percents };
}
