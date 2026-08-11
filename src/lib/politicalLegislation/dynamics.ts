/**
 * SP2 dynamics — pure target/drift math (spec §2/§2.1/§6 of
 * 2026-07-20-political-metrics-dynamics-design.md). Targets compose from the
 * TYPED catalog (the SSOT for targets/weights), never the projected
 * legislationTypes docs. The turn phase applies driftStep to REGIONAL values
 * only; the national display stays the SP1 read-time aggregate.
 */

import { POLITICAL_METRIC_FAMILIES } from "../politicalMetrics/families";
import type { PoliticalMetricId } from "../politicalMetrics/types";
import { getCatalog } from "./catalog";
import type { LawCountryId } from "./types";

/** §2 ruling: primary 12.5 pts/level — a full L0→L4 swing commands 50 points. */
export const PRIMARY_POINTS_PER_LEVEL = 12.5;
/** §2 ruling: secondary 5 pts/level × weight. */
export const SECONDARY_POINTS_PER_LEVEL = 5;
/** §2 ruling: regional enactments supplement at half strength. */
export const REGIONAL_SUPPLEMENT_FACTOR = 0.5;
/** §2.1 ruling: 0.5% of the remaining gap per turn. */
export const DRIFT_RATE_PER_TURN = 0.005;
/** §2.1 ruling: minimum per-turn movement while a gap exists. */
export const DRIFT_FLOOR = 0.01;

function lawPoints(kind: "primary" | "secondary", level: number, weight: number): number {
  return kind === "primary"
    ? PRIMARY_POINTS_PER_LEVEL * level
    : SECONDARY_POINTS_PER_LEVEL * level * weight;
}

/**
 * metricId → points implied by a level map (lawId → 0–4). One formula for the
 * national law book AND regional supplements (§2). Missing law = level 0.
 */
export function lawTargets(
  countryId: string,
  levels: ReadonlyMap<string, number>
): Record<PoliticalMetricId, number> {
  const out = {} as Record<PoliticalMetricId, number>;
  for (const family of POLITICAL_METRIC_FAMILIES) out[family.id] = 0;
  for (const law of getCatalog(countryId)) {
    if (law.kind === "tax") continue;
    const level = levels.get(law.id) ?? 0;
    if (level <= 0) continue;
    for (const target of law.targets) {
      out[target.metricId] += lawPoints(law.kind, level, target.weight);
    }
  }
  return out;
}

/** §2: clamp(national + 0.5 × supplement + residual, 0, 100). */
export function composeTarget(
  nationalPoints: number,
  regionalSupplementPoints: number,
  residual: number
): number {
  const target = nationalPoints + REGIONAL_SUPPLEMENT_FACTOR * regionalSupplementPoints + residual;
  return Math.max(0, Math.min(100, target));
}

/**
 * §2.1 motion: one turn of drift toward target. Snaps inside the floor so
 * values never oscillate around the target; floors tiny steps so tail gaps
 * close instead of asymptoting. Returns the NEW value.
 */
export function driftStep(value: number, target: number): number {
  const gap = target - value;
  // Epsilon on the snap so accumulated float error from floored steps cannot
  // strand a value one micro-gap away from its target.
  if (Math.abs(gap) <= DRIFT_FLOOR + 1e-9) return target;
  let step = gap * DRIFT_RATE_PER_TURN;
  if (Math.abs(step) < DRIFT_FLOOR) step = DRIFT_FLOOR * Math.sign(gap);
  return value + step;
}

export interface ModifierRow {
  lawId: string;
  title: string;
  levelName: string;
  level: number;
  /** Signed contribution to the metric's target; L0 (zero) rows are omitted. */
  points: number;
}

/**
 * §6 Active-modifiers decomposition: one row per law contributing to the
 * metric at the given levels, sorted by contribution descending. Display-only
 * — the rows sum to lawTargets()[metricId] by construction.
 */
export function metricModifierRows(
  countryId: LawCountryId,
  metricId: PoliticalMetricId,
  levels: ReadonlyMap<string, number>
): ModifierRow[] {
  const rows: ModifierRow[] = [];
  for (const law of getCatalog(countryId)) {
    if (law.kind === "tax" || !law.levels) continue;
    const target = law.targets.find((t) => t.metricId === metricId);
    if (!target) continue;
    const level = levels.get(law.id) ?? 0;
    if (level <= 0) continue;
    rows.push({
      lawId: law.id,
      title: law.title,
      levelName: law.levels[level]?.name ?? `Level ${level}`,
      level,
      points: lawPoints(law.kind, level, target.weight),
    });
  }
  return rows.sort((a, b) => b.points - a.points);
}
