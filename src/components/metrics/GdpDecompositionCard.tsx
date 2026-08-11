"use client";

import { decomposeGdpGrowth } from "@/lib/metricEngine/gdpDecomposition";
import { formatGDP } from "@/lib/utils/formatters";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";

interface Props {
  gdp: number | null;
  gdpGrowth: number;
  potentialGrowth: number;
  outputGap: number | null;
  laborForce: number | null;
  countryId: string;
}

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

/**
 * GDP growth decomposed into its supply-side potential trend and the cyclical
 * (output-gap) component — `gdpGrowth = potential + cyclical` by construction in
 * the engine. A diverging bar shows how far above/below trend the region runs.
 */
export function GdpDecompositionCard({
  gdp,
  gdpGrowth,
  potentialGrowth,
  outputGap,
  laborForce,
  countryId,
}: Props) {
  const d = decomposeGdpGrowth(gdpGrowth, potentialGrowth);
  // Scale the split bar against the larger of |potential| and |total| so both
  // segments stay on one axis; guard a zero denominator.
  const scale = Math.max(Math.abs(d.potential), Math.abs(d.total), 0.1);
  const potentialW = (Math.abs(d.potential) / scale) * 100;
  const cyclicalW = (Math.abs(d.cyclical) / scale) * 100;

  return (
    <div className="rounded-lg border border-card-border bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          GDP &amp; Growth
        </h4>
        <span
          className={`text-[10px] font-semibold ${d.isExpansionary ? "text-success" : "text-error"}`}
        >
          {d.isExpansionary ? "Above trend" : "Below trend"}
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <span className="block text-[10px] uppercase tracking-widest text-muted">GDP</span>
          <span className="text-sm font-bold tabular-nums text-foreground">
            {gdp != null ? formatGDP(gdp, getCurrencyPrefix(countryId)) : "—"}
          </span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-widest text-muted">Growth /yr</span>
          <span className="text-sm font-bold tabular-nums text-foreground">{pct(d.total)}</span>
        </div>
      </div>

      {/* Potential vs cyclical split bar */}
      <div className="space-y-1.5">
        <div className="flex h-3 overflow-hidden rounded-full bg-card-border/40">
          <div
            className="h-full bg-info"
            style={{ width: `${potentialW}%` }}
            title={`Potential ${pct(d.potential)}`}
          />
          <div
            className={`h-full ${d.cyclical >= 0 ? "bg-success" : "bg-error"}`}
            style={{ width: `${cyclicalW}%` }}
            title={`Cyclical ${pct(d.cyclical)}`}
          />
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-info">Potential {pct(d.potential)}</span>
          <span className={d.cyclical >= 0 ? "text-success" : "text-error"}>
            Cyclical {pct(d.cyclical)}
          </span>
        </div>
      </div>

      {(outputGap != null || laborForce != null) && (
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-card-border/50 pt-3">
          {outputGap != null && (
            <div>
              <span className="block text-[10px] uppercase tracking-widest text-muted">
                Output gap
              </span>
              <span className="text-xs font-semibold tabular-nums text-foreground">
                {pct(outputGap)}
              </span>
            </div>
          )}
          {laborForce != null && (
            <div>
              <span className="block text-[10px] uppercase tracking-widest text-muted">
                Labor force
              </span>
              <span className="text-xs font-semibold tabular-nums text-foreground">
                {laborForce.toLocaleString("en-US")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
