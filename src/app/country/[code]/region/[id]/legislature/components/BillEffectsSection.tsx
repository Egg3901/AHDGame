"use client";

import { useState } from "react";
import { BillProvisionDisplay, METRIC_NAMES } from "@/lib/legislature/dto/stateLegislature";
import { getMetricDefinition } from "@/lib/constants/metricDefinitions";
import { MIRROR_CONTROLLED_METRIC_IDS } from "@/lib/metricEngine/fiscalMirror";
import type { MetricCategoryId } from "@/lib/db/types";

export function BillEffectsSection({ provisions }: { provisions: BillProvisionDisplay[] }) {
  const [open, setOpen] = useState(false);

  // Aggregate all metric effects across provisions
  const allMetricEffects: { name: string; direction: "up" | "down"; isGood: boolean }[] = [];
  let totalCostPerCapita = 0;
  let hasGdpMultiplier = false;

  for (const prov of provisions) {
    if (prov.effectTargetsWeighted?.length && prov.effectDirection !== 0) {
      for (const target of prov.effectTargetsWeighted) {
        // 📊 budget-sync: computed fiscal metrics are mirror-owned — don't show
        // them as bill effects (laws move them only via real spending/tax).
        if (MIRROR_CONTROLLED_METRIC_IDS.has(target.metricId)) continue;
        const metricName = METRIC_NAMES[target.metricId] || target.metricId;
        // Mirror the runtime contribution formula from formulas.ts:
        //   contribution = effectDirection × weight × scope × (isHigherBetter ? 1 : -1)
        // Source isHigherBetter from the canonical metric definition so welfare/health
        // metrics (povertyRate, uninsuredRate, ...) render the same direction the
        // engine actually applies.
        const def = getMetricDefinition(
          target.metricCategoryId as MetricCategoryId,
          target.metricId
        );
        const isHigherBetter = def?.isHigherBetter ?? true;
        const weightSign = target.weight >= 0 ? 1 : -1;
        const contributionSign = prov.effectDirection * weightSign * (isHigherBetter ? 1 : -1);
        if (contributionSign === 0) continue;
        const goesUp = contributionSign > 0;
        const isGood = goesUp === isHigherBetter;
        if (!allMetricEffects.find((e) => e.name === metricName)) {
          allMetricEffects.push({ name: metricName, direction: goesUp ? "up" : "down", isGood });
        }
      }
    }
    if (prov.annualCostPerCapita) totalCostPerCapita += prov.annualCostPerCapita;
    if (prov.gdpPerCapitaMultiplier) hasGdpMultiplier = true;
  }

  if (allMetricEffects.length === 0 && totalCostPerCapita === 0 && !hasGdpMultiplier) return null;

  return (
    <div className="mt-3 pt-3 border-t border-card-border/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors"
      >
        <svg
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
        Effects & Cost
        {allMetricEffects.length > 0 && (
          <span className="ml-1 opacity-60">({allMetricEffects.length} metrics)</span>
        )}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {allMetricEffects.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {allMetricEffects.map(({ name, direction, isGood }) => (
                <span
                  key={name}
                  className={`inline-flex items-center gap-0.5 text-xs ${isGood ? "text-success" : "text-error"}`}
                >
                  {direction === "up" ? (
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                    </svg>
                  ) : (
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                  {name}
                </span>
              ))}
            </div>
          )}
          {(totalCostPerCapita > 0 || hasGdpMultiplier) && (
            <div className="text-xs text-muted">
              <span className="font-medium text-foreground/80">Cost: </span>
              {totalCostPerCapita > 0 && (
                <span>${totalCostPerCapita.toLocaleString("en-US")}/person/yr</span>
              )}
              {hasGdpMultiplier && <span className="ml-1 text-muted/70">(scales with GDP)</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
