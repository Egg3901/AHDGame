import type { CrisisEffect } from "@/lib/db/types/crisis";
import { getMetricShortName } from "@/lib/constants/metricDefinitions";

/**
 * Round a crisis effect magnitude for display: at most two decimals, no
 * trailing zeros.
 *
 * Effect values are floats and land with binary-rounding tails — authoring
 * 0.15 three times over stores 0.44999999999999996, and the live recession
 * carries -0.6599999999999999. Every surface that prints one needs this, and
 * each used to keep its own copy; the sign is the caller's to add, since some
 * surfaces colour it instead.
 */
export function formatCrisisEffectValue(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function camelToTitle(s: string): string {
  return s
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function slugToTitle(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Resolve a crisis effect to the canonical game stat it actually moves.
 *
 * Every effect carries a freeform `label` (flavor prose like "Austerity GDP
 * deepening") that corresponds to no real stat — it's just a caption a template
 * author typed. The mechanical target is the resolved
 * `(targetType, metricCategory, metricField)` tuple, already alias-resolved at
 * template-build time (see `templates.ts` METRIC_ALIASES). This maps that tuple
 * back to the player-facing stat name used everywhere else (national metrics
 * dashboard, region pages) so crisis effect chips "link up" to a recognizable
 * stat instead of dangling prose.
 *
 * It also surfaces the engine's real shape honestly: several template concepts
 * (investor/consumer confidence) alias onto one metric (Small Business
 * Formation), and the segmented approval labels (business/workers/base) all
 * collapse onto a single Government Approval figure — `applyEffects.ts` writes
 * them to one `approvalRating`. Keep the prose as a tooltip for the flavor.
 */
export function formatCrisisEffectTarget(effect: CrisisEffect): string {
  switch (effect.targetType) {
    case "approval":
      return "Government Approval";
    case "inflation":
      return "Inflation Rate";
    case "gdpLoss":
      return "Regional GDP";
    case "profitMargin": {
      const parts: string[] = [];
      if (effect.sectorType) parts.push(slugToTitle(effect.sectorType));
      if (effect.strategyId) parts.push(slugToTitle(effect.strategyId));
      return parts.length ? `${parts.join(" → ")} Profit Margin` : "All Sectors Profit Margin";
    }
    case "metric":
      if (effect.metricField) {
        return getMetricShortName(effect.metricField) ?? camelToTitle(effect.metricField);
      }
      return "Metric";
    case "stat":
      if (effect.statKey) {
        return effect.statKey.charAt(0).toUpperCase() + effect.statKey.slice(1);
      }
      return "Character Stat";
    default:
      return "Effect";
  }
}
