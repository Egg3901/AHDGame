/**
 * Regression guard for the "rounding-plateau" class (bug #0800): a cabinet
 * effect (order / tier setting / regional target / advocacy / emergency) whose
 * per-turn applied step is at or below the metric engine's storage half-grain
 * is reabsorbed by `roundTo(value, node.decimals)` every turn, so the metric
 * never moves — the holder sees zero effect.
 *
 * For every cabinet effect that targets an engine-animated registry node, the
 * applied step (capped + span-scaled exactly as the turn phase does) MUST exceed
 * the node's storage half-grain. Root metrics (no registry node) are not
 * rewritten by the engine, so they are exempt.
 */
import { describe, it, expect } from "vitest";
import { METRIC_REGISTRY_SORTED } from "@/lib/metricEngine/registry";
import { resolveMetricPath } from "@/lib/cabinet/resolveMetricPath";
import { getAllCabinetMechanics } from "@/lib/constants/cabinetMechanics";
import { getMinisterialOrders } from "@/lib/constants/cabinetOrders";
import {
  modifierSpanScale,
  MAX_PER_METRIC_MODIFIER_PER_TURN,
  CABINET_EFFECT_STRENGTH,
} from "@/lib/turn/ministerialOrderProcessing";

const COUNTRIES = ["UK", "US", "JP", "IE", "DE", "CN"] as const;

const nodeByPath = new Map(METRIC_REGISTRY_SORTED.map((n) => [n.id, n]));

interface EffRow {
  country: string;
  position: string;
  source: string;
  metricKey: string;
  modifier: number;
}

function collectEffects(): EffRow[] {
  const rows: EffRow[] = [];
  for (const country of COUNTRIES) {
    const mechanics = getAllCabinetMechanics(country);
    for (const [position, m] of Object.entries(mechanics)) {
      const push = (source: string, effects?: Record<string, number>) => {
        if (!effects) return;
        for (const [metricKey, modifier] of Object.entries(effects)) {
          rows.push({ country, position, source, metricKey, modifier });
        }
      };
      if (m.tierSetting) for (const o of m.tierSetting.options) push(`tier:${o.id}`, o.effects);
      push("regionalTarget", m.regionalTarget?.effects);
      push("regionalTarget:nonTarget", m.regionalTarget?.nonTargetEffects);
      push("advocacy", m.advocacy?.effects);
      push("emergency", m.emergency?.effects);
      push("emergency:side", m.emergency?.sideEffects);
      for (const order of getMinisterialOrders(country, position)) {
        for (const e of order.effects) {
          rows.push({
            country,
            position,
            source: `order:${order.id}`,
            metricKey: e.metric,
            modifier: e.modifier,
          });
        }
      }
    }
  }
  return rows;
}

/** Applied per-turn step the ministerialOrders phase writes (strength, then cap, then span-scale). */
function appliedStep(path: string, modifier: number): number {
  const boosted = Math.abs(modifier) * CABINET_EFFECT_STRENGTH;
  const capped = Math.min(boosted, MAX_PER_METRIC_MODIFIER_PER_TURN);
  return capped * modifierSpanScale(path);
}

describe("cabinet effects must not be reabsorbed by metric-engine rounding (bug #0800)", () => {
  const rows = collectEffects();

  it("collects a non-trivial set of cabinet effects to guard", () => {
    expect(rows.length).toBeGreaterThan(100);
  });

  it("every cabinet effect on a registry node applies above the storage half-grain", () => {
    const frozen: string[] = [];
    for (const r of rows) {
      const position = getAllCabinetMechanics(r.country)[r.position] as {
        nationalMetrics?: { category: string; metricId: string }[];
        regionalMetrics?: { category: string; metricId: string }[];
      };
      const positionMetrics = [
        ...(position?.nationalMetrics ?? []),
        ...(position?.regionalMetrics ?? []),
      ];
      const path = resolveMetricPath(r.metricKey, positionMetrics);
      const node = nodeByPath.get(path);
      if (!node) continue; // root metric — engine does not round it
      const decimals = node.decimals ?? 3;
      const halfGrain = 0.5 * 10 ** -decimals;
      const applied = appliedStep(path, r.modifier);
      if (applied <= halfGrain) {
        frozen.push(
          `${r.country}/${r.position}/${r.source} ${path} mod=${r.modifier} applied=${applied.toFixed(4)} dec=${decimals} halfGrain=${halfGrain}`
        );
      }
    }
    expect(frozen, `\n${frozen.length} frozen cabinet effects:\n${frozen.join("\n")}\n`).toEqual(
      []
    );
  });
});
