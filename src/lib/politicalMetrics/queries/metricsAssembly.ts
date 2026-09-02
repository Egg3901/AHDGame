/**
 * Shared assembly for the political-metrics registry, at BOTH scopes.
 *
 * The national loader and the region loader must never disagree about what a
 * law contributes, what the cabinet channel is worth, or how fast a value
 * drifts. Keeping that arithmetic here — rather than copied into each loader —
 * is what makes a future retune of `DRIFT_RATE_PER_TURN` or
 * `CABINET_RESIDUAL_CAP_PER_SOURCE` land on both views at once.
 */

import {
  composeTarget,
  DRIFT_RATE_PER_TURN,
  metricModifierRows,
  REGIONAL_SUPPLEMENT_FACTOR,
  type ModifierRow,
} from "@/lib/politicalLegislation/dynamics";
import type { LawCountryId } from "@/lib/politicalLegislation/types";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import {
  CABINET_RESIDUAL_CAP_PER_SOURCE,
  CABINET_RESIDUAL_TOTAL_CEILING,
  CABINET_SOURCE_IDS,
  cappedSourceCount,
  type CabinetSourceId,
} from "../cabinetResidual";
import type { PoliticalMetricId } from "../types";

/** One cabinet channel's contribution to a metric. */
export interface CabinetSourceContribution {
  source: CabinetSourceId;
  value: number;
  /** True when this channel sits at its own ceiling. */
  atCap: boolean;
}

export interface MetricModifiersInfo {
  /** Contributing NATIONAL laws (sorted by points desc; L0 rows omitted). */
  laws: ModifierRow[];
  /**
   * The region's OWN enacted laws, already scaled by
   * REGIONAL_SUPPLEMENT_FACTOR so the rows sum to the supplement the target
   * actually received. Empty at national scope.
   *
   * Scaling here rather than in the UI is deliberate: a row showing the raw
   * ladder points would not add up to the target beside it, and a player
   * reconciling the two would conclude one of them was lying.
   */
  regionalLaws: ModifierRow[];
  /** Structural residual (rounded 0.1). Population-weighted at national scope. */
  residual: number;
  /**
   * Cabinet residual (rounded 0.1) — the standing contribution of tier
   * settings, ministerial orders and sited estates. Ticket #1129: this term
   * moves the target the engine drifts toward, so omitting it made the served
   * target disagree with the engine and left a player's built estates with no
   * visible effect anywhere.
   */
  cabinet: number;
  /**
   * The labour-relations channel (the strike/settlement provider). Applied to
   * every region's target by the turn phase and, until now, displayed at
   * neither scope — so a strike wave moved national politics with no traceable
   * cause on any surface.
   */
  labour: number;
  /**
   * Which cabinet channels actually contribute, largest first, so a player can
   * see WHICH one is moving the metric rather than one aggregate label
   * (ticket #1142). Zero-contribution channels are omitted.
   */
  cabinetBySource: CabinetSourceContribution[];
  /**
   * True when EVERY cabinet channel for this metric is pinned at
   * ±CABINET_RESIDUAL_CAP_PER_SOURCE. Only then does a further order or estate
   * contribute exactly nothing.
   */
  cabinetAtCap: boolean;
  /** The per-channel cap, so the UI can name the ceiling rather than hard-code it. */
  cabinetCap: number;
  /**
   * Turns for the value to close half the remaining gap at the engine's drift
   * rate. Derived, so it stays true if the rate is retuned.
   */
  driftHalfLifeTurns: number;
  /**
   * The LAW AND STRUCTURE target: composeTarget(national, supplement, residual
   * + cabinet + labour).
   *
   * The turn phase's real target additionally carries `macroTerm` and
   * `engineTerm` (see `turn/politicalMetricsDynamics.ts`), and NEITHER is
   * persisted — both are recomputed each turn from the region's macro doc and
   * the metric engine's political nodes. A read path cannot reproduce them
   * without re-running the engine, so they are excluded here and the UI labels
   * this figure accordingly rather than implying it is the engine's full target.
   */
  target: number;
  /** Drift direction vs the current value (|gap| ≤ 0.1 = flat). */
  direction: "up" | "down" | "flat";
}

/** Turns to close half a gap at `rate` per turn (exponential half-life). */
export function driftHalfLifeTurns(rate: number): number {
  if (rate <= 0 || rate >= 1) return 0;
  return Math.round(Math.log(0.5) / Math.log(1 - rate));
}

/**
 * ONE region's cabinet split for a metric — the per-doc case the national mean
 * is built by weighting.
 *
 * A doc with no per-source split yet (written before the split, or a region the
 * ministerial step has not touched since) falls back to comparing its flat
 * total against the full ceiling, which is the same question.
 */
export function cabinetContributionsFor(
  doc: Pick<PoliticalMetricsDoc, "cabinetResiduals" | "cabinetResidualsBySource">,
  metricId: PoliticalMetricId
): { total: number; saturated: boolean; bySource: CabinetSourceContribution[] } {
  const total = doc.cabinetResiduals?.[metricId] ?? 0;
  const bySourceMap = doc.cabinetResidualsBySource;
  const saturated = bySourceMap
    ? cappedSourceCount(bySourceMap, metricId) >= CABINET_SOURCE_IDS.length
    : Math.abs(total) >= CABINET_RESIDUAL_TOTAL_CEILING - 0.01;
  const bySource: CabinetSourceContribution[] = CABINET_SOURCE_IDS.map((source) => {
    const value = bySourceMap?.[source]?.[metricId] ?? 0;
    return {
      source,
      value: Math.round(value * 10) / 10,
      atCap: Math.abs(value) >= CABINET_RESIDUAL_CAP_PER_SOURCE - 0.01,
    };
  })
    .filter((row) => row.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return { total, saturated, bySource };
}

export interface ModifiersInput {
  countryId: LawCountryId;
  metricId: PoliticalMetricId;
  /** National enacted levels, for the law rows. */
  nationalLevels: ReadonlyMap<string, number>;
  /** The region's own enacted levels; an EMPTY map at national scope. */
  regionalLevels: ReadonlyMap<string, number>;
  nationalPoints: number;
  /** Raw (un-halved) regional ladder points; composeTarget applies the factor. */
  regionalSupplementPoints: number;
  residual: number;
  cabinet: number;
  labour: number;
  cabinetBySource: CabinetSourceContribution[];
  cabinetAtCap: boolean;
  /** The value the target is compared against, for `direction`. */
  currentValue: number;
}

export function buildModifiers(input: ModifiersInput): MetricModifiersInfo {
  const laws = metricModifierRows(input.countryId, input.metricId, input.nationalLevels);
  const regionalLaws =
    input.regionalLevels.size > 0
      ? metricModifierRows(input.countryId, input.metricId, input.regionalLevels).map((row) => ({
          ...row,
          points: row.points * REGIONAL_SUPPLEMENT_FACTOR,
        }))
      : [];
  const target = composeTarget(
    input.nationalPoints,
    input.regionalSupplementPoints,
    input.residual + input.cabinet + input.labour
  );
  const gap = target - input.currentValue;
  return {
    laws,
    regionalLaws,
    residual: Math.round(input.residual * 10) / 10,
    cabinet: Math.round(input.cabinet * 10) / 10,
    labour: Math.round(input.labour * 10) / 10,
    cabinetBySource: input.cabinetBySource,
    cabinetAtCap: input.cabinetAtCap,
    cabinetCap: CABINET_RESIDUAL_CAP_PER_SOURCE,
    driftHalfLifeTurns: driftHalfLifeTurns(DRIFT_RATE_PER_TURN),
    target: Math.round(target * 10) / 10,
    direction: Math.abs(gap) <= 0.1 ? "flat" : gap > 0 ? "up" : "down",
  };
}
